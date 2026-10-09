// A single DX7 "part" (timbre): owns its voice pool, controllers, LFO and the
// current 156-byte voice, and renders mono audio. Extracted from SynthUnit so
// that both the single-timbre SynthUnit and the multi-timbral SynthRack can
// share the exact same voice-management and render logic.
//
// A Part renders mono and applies NO global FX - the host (SynthUnit or
// SynthRack) owns the filter/master-gain/pan stage.

import { N } from './synth';
import { Lfo } from './lfo';
import { FmCore } from './fm-core';
import { EngineMkI } from './engine-mki';
import { EngineOpl } from './engine-opl';
import {
  Controllers,
  applySupplementToControllers,
  kControllerPitch,
  kControllerPitchRangeUp,
  kControllerPitchRangeDn,
  kControllerPitchStep,
} from './controllers';
import { Dx7Note, type VoiceStatus } from './dx7note';
import { createStandardTuning, type TuningState } from './tuning';
import { initVoice } from '@texed/dx7-format/cartridge';
import { G } from '@texed/dx7-format/voice';
import { VoiceSupplement, createDefaultAmem, AMEM_SLOT_SIZE } from '@texed/dx7-format/amem';

export const MAX_ACTIVE_NOTES = 32;

export const EngineType = { Modern: 0, MarkI: 1, Opl: 2 } as const;
export type EngineType = (typeof EngineType)[keyof typeof EngineType];

/** Live envelope and LFO state for one part, as shown on the meters. */
export interface PartStatus {
  amps: number[];
  steps: number[];
  levels: number[];
  pitchStep: number;
  pitchLevel: number;
  lfo: number;
  lfoRestart: number;
}

interface Voice {
  dx7Note: Dx7Note;
  midiNote: number;
  velocity: number;
  channel: number;
  keydown: boolean;
  /** Held by the sustain pedal (CC 64). */
  sustained: boolean;
  /** Held by the sostenuto pedal (CC 66): keys that were down when it engaged. */
  sostenuto: boolean;
  /** Held by hold-2 (CC 69), which lets go on the next note with no key down. */
  hold2: boolean;
  live: boolean;
  keydownSeq: number;
  /** Forced-damp fade in progress: still audible, but no longer counts toward
   * the polyphony budget and is not a steal candidate (see killOldest). */
  damping: boolean;
}

export class Part {
  private tuningState: TuningState = createStandardTuning();
  private controllers = new Controllers();
  private lfo = new Lfo();
  private engines: FmCore[];

  private voices: Voice[] = [];
  private data = initVoice();
  private supplement = new VoiceSupplement(createDefaultAmem());
  private monoMode = false;

  private currentNote = 0;
  private nextKeydownSeq = 0;
  private lastActiveVoice = 0;
  private sustain = false;
  private hold2 = false;

  /** Performance-level transpose (semitones) added to engine pitch only; does
   * not affect note-on/off matching. Set by SynthRack from the part's noteShift. */
  extraTranspose = 0;

  /** Performance-level detune in cents (−7..+7). Set by SynthRack from PartConfig.detune. */
  extraDetune = 0;

  /** TX802 EG Forced Damp. ON (default): a stolen voice restarts its envelope
   * from 0 (entire attack reproduced). OFF: the new note continues from the
   * stolen note's current envelope level. Set by SynthRack from PartConfig. */
  forcedDamp = true;

  private lastLfoValue = 0;
  private lastLfoDelay = 0;
  // Increments each time the LFO is (re)triggered, so the UI can restart its
  // LFO position sweep at the exact note-on that restarted the LFO.
  private lfoRestartSeq = 0;
  private peekStatus: VoiceStatus = {
    amp: [0, 0, 0, 0, 0, 0],
    ampStep: [0, 0, 0, 0, 0, 0],
    level: [0, 0, 0, 0, 0, 0],
    pitchStep: 0,
    pitchLevel: 0,
  };
  // See getStatus: reused so the audio thread does not allocate to report state.
  private status: PartStatus = {
    amps: [0, 0, 0, 0, 0, 0],
    steps: [4, 4, 4, 4, 4, 4],
    levels: [0, 0, 0, 0, 0, 0],
    pitchStep: 4,
    pitchLevel: 0,
    lfo: 0,
    lfoRestart: 0,
  };

  private extraBuf = new Float32Array(N);
  private extraBufSize = 0;
  private audiobuf = new Int32Array(N);
  private sumbuf = new Float32Array(N);

  constructor() {
    const modern = new FmCore();
    const mki = new EngineMkI();
    const opl = new EngineOpl();
    this.engines = [modern, mki, opl];
    this.controllers.core = mki;

    for (let i = 0; i < MAX_ACTIVE_NOTES; i++) {
      this.voices.push({
        dx7Note: new Dx7Note(this.tuningState),
        midiNote: -1,
        velocity: 0,
        channel: 1,
        keydown: false,
        sustained: false,
        sostenuto: false,
        hold2: false,
        live: false,
        keydownSeq: -1,
        damping: false,
      });
    }

    this.controllers.values_[kControllerPitch] = 0x2000;
    this.controllers.values_[kControllerPitchRangeUp] = 3;
    this.controllers.values_[kControllerPitchRangeDn] = 3;
    this.controllers.values_[kControllerPitchStep] = 0;
    this.controllers.masterTune = 0;
    // Canonical DX7 default mod routing (see SynthUnit history): mod wheel adds
    // pitch-LFO (vibrato), aftertouch adds amplitude-LFO.
    this.controllers.wheel.pitchRange = 99;
    this.controllers.at.ampRange = 99;
    this.controllers.refresh();

    this.lfo.reset(this.data.subarray(G.lfoSpeed));
  }

  setEngineType(type: EngineType): void {
    this.controllers.core = this.engines[type] ?? this.engines[EngineType.MarkI];
  }

  loadVoice(patch: Uint8Array): void {
    // A bare voice (VCED) leaves the DX7II supplement untouched, matching
    // hardware behavior where a voice edit keeps the current ACED buffer.
    this.loadVoiceData(patch);
  }

  /** Load VMEM + AMEM together (DX7II bank slot). */
  loadVoiceSlot(vmem: Uint8Array, amem: Uint8Array): void {
    this.loadVoiceData(vmem, amem);
  }

  private loadVoiceData(vmem: Uint8Array, amem?: Uint8Array): void {
    this.clearActiveVoices();
    this.data.set(vmem.subarray(0, 156));
    if (amem) this.supplement = new VoiceSupplement(amem);
    this.monoMode = this.supplement.mono;
    this.applySupplementToControllers();
    this.refreshVoices();
  }

  getSupplementData(): Uint8Array {
    return this.supplement.raw.slice();
  }

  /** Edit one byte of the 35-byte AMEM supplement and re-apply it. */
  setSupplementParam(offset: number, value: number): void {
    if (offset < 0 || offset >= AMEM_SLOT_SIZE) return;
    if (this.supplement.raw[offset] === value) return;
    const raw = createDefaultAmem();
    raw.set(this.supplement.raw.subarray(0, AMEM_SLOT_SIZE));
    raw[offset] = value & 0x7f;
    this.supplement = new VoiceSupplement(raw);
    this.monoMode = this.supplement.mono;
    this.applySupplementToControllers();
    this.refreshVoices();
  }

  private applySupplementToControllers(): void {
    applySupplementToControllers(this.supplement, this.controllers);
    for (const v of this.voices) {
      v.dx7Note.setSupplement(this.supplement);
    }
  }

  /** Retunes in place: the voices already share this part's tuning table. */
  setMasterTuneCents(cents: number): void {
    this.tuningState.setMasterTuneCents(cents);
  }

  /** Swap the whole tuning table (standard or a micro-tuning). */
  setTuning(state: TuningState): void {
    this.tuningState = state;
    for (const v of this.voices) {
      v.dx7Note.setTuningState(state);
    }
  }

  setVoiceParam(offset: number, value: number): void {
    if (offset < 0 || offset > 155) return;
    if (this.data[offset] === value) return;
    this.data[offset] = value;
    this.refreshVoices();
    // delayinc updates in reset, but an already-finished ramp would stay full;
    // clear so editing DELAY while a note rings restarts the hold/fade.
    if (offset === G.lfoDelay) this.lfo.restartDelay();
  }

  getVoiceData(): Uint8Array {
    return this.data.slice();
  }

  /** Silence all active voices before a full program/voice swap (matches desktop Dexed). */
  clearActiveVoices(): void {
    for (let i = 0; i < MAX_ACTIVE_NOTES; i++) {
      const v = this.voices[i];
      if (!v.live) continue;
      v.keydown = false;
      v.sustained = false;
      v.sostenuto = false;
      v.hold2 = false;
      v.damping = false;
      v.dx7Note.keyup();
      v.live = false;
      v.midiNote = -1;
    }
  }

  private refreshVoices(): void {
    this.controllers.opSwitch = Array.from({ length: 6 }, (_, op) =>
      this.data[G.opEnable] & (1 << op) ? '1' : '0',
    ).join('');
    for (const v of this.voices) {
      if (v.live) v.dx7Note.update(this.data, this.enginePitch(v.midiNote), v.velocity);
    }
    this.lfo.reset(this.data.subarray(G.lfoSpeed));
  }

  // ==== MIDI handling ====

  private chooseNote(pitch: number): number {
    let bestNote = this.currentNote;
    let bestScore = -1;
    let note = this.currentNote;
    for (let i = 0; i < MAX_ACTIVE_NOTES; i++) {
      let score = 0;
      if (!this.voices[note].dx7Note.isPlaying()) score += 4;
      if (!this.voices[note].keydown) score += 2;
      if (this.voices[note].midiNote === pitch) score += 1;
      if (
        score > bestScore ||
        (score === bestScore && this.voices[note].keydownSeq < this.voices[bestNote].keydownSeq)
      ) {
        bestNote = note;
        bestScore = score;
      }
      note = (note + 1) % MAX_ACTIVE_NOTES;
    }
    return bestNote;
  }

  private transpositionShift(): number {
    return this.data[G.transpose] - 24 + this.extraTranspose;
  }

  private enginePitch(midiNote: number): number {
    return midiNote + this.transpositionShift() + this.extraDetune / 100;
  }

  noteOn(pitch: number, velocity: number, channel = 1): void {
    if (velocity === 0) {
      this.noteOff(pitch, channel);
      return;
    }

    if (this.monoMode) {
      for (let i = 0; i < MAX_ACTIVE_NOTES; i++) {
        if (this.voices[i].keydown) {
          this.voices[i].keydown = false;
          this.voices[i].dx7Note.keyup();
        }
      }
    }

    // Hold-2 keeps notes ringing after key-up, and lets go of them when a new
    // note starts a fresh phrase rather than when the pedal lifts.
    if (this.hold2 && !this.anyKeyDown()) {
      for (const v of this.voices) {
        if (!v.hold2) continue;
        v.hold2 = false;
        this.maybeRelease(v);
      }
    }

    // LFO key trigger: "single" restarts only on the first key down; "multi"
    // (AMEM LTRG) retriggers on every note-on.
    if (this.supplement.lfoKeyTrigger || !this.anyKeyDown()) {
      this.lfo.keydown();
      this.lfoRestartSeq++;
    }

    // DX7II unison poly: stack four detuned voices per note (hardware plays
    // 4 notes of the 16-voice pool per key in single mode).
    if (this.supplement.unison) {
      const spreadCents = (this.supplement.unisonDetune + 1) * 5;
      for (const k of [-1.5, -0.5, 0.5, 1.5]) {
        this.triggerVoice(pitch, velocity, channel, k * spreadCents);
      }
    } else {
      this.triggerVoice(pitch, velocity, channel, 0);
    }
  }

  private triggerVoice(
    pitch: number,
    velocity: number,
    channel: number,
    detuneCents: number,
  ): void {
    const note = this.chooseNote(pitch);
    this.currentNote = (note + 1) % MAX_ACTIVE_NOTES;
    const v = this.voices[note];
    v.channel = channel;
    v.midiNote = pitch;
    v.velocity = velocity;
    v.sustained = this.sustain;
    v.sostenuto = false;
    v.hold2 = false;
    v.keydown = true;
    v.damping = false;
    v.keydownSeq = this.nextKeydownSeq++;

    const voiceSteal = v.dx7Note.isPlaying();
    // Forced Damp OFF: a stolen (still-playing) slot continues its envelope into
    // the new note. ON (or a free slot): restart the envelope from the beginning.
    const continueEnv = voiceSteal && !this.forcedDamp;
    v.dx7Note.setSupplement(this.supplement);
    v.dx7Note.init(this.data, this.enginePitch(pitch) + detuneCents / 100, velocity, continueEnv);
    if (this.data[G.oscKeySync] && !voiceSteal) {
      v.dx7Note.oscSync();
    }
    if (
      this.voices[this.lastActiveVoice].midiNote !== -1 &&
      this.controllers.portamentoEnableCc &&
      this.controllers.portamentoCc > 0
    ) {
      v.dx7Note.initPortamento(this.voices[this.lastActiveVoice].dx7Note);
    }

    if (!this.data[G.oscKeySync]) {
      for (let i = 0; i < MAX_ACTIVE_NOTES; i++) {
        if (i !== note && this.voices[i].dx7Note.isPlaying() && this.voices[i].midiNote === pitch) {
          v.dx7Note.transferPhase(this.voices[i].dx7Note);
          break;
        }
      }
    }

    v.live = true;
    this.lastActiveVoice = note;
  }

  noteOff(pitch: number, channel = 1): void {
    // Release every matching voice: unison stacks four voices per note.
    let released = false;
    for (let note = 0; note < MAX_ACTIVE_NOTES; note++) {
      const v = this.voices[note];
      if (v.midiNote === pitch && v.keydown && v.channel === channel) {
        this.keyUp(v);
        released = true;
      }
    }
    if (released) return;

    for (let note = 0; note < MAX_ACTIVE_NOTES; note++) {
      const v = this.voices[note];
      if (v.midiNote === pitch && v.keydown) this.keyUp(v);
    }
  }

  private anyKeyDown(): boolean {
    for (const v of this.voices) if (v.keydown) return true;
    return false;
  }

  private keyUp(v: Voice): void {
    v.keydown = false;
    if (this.sustain) v.sustained = true;
    if (this.hold2) v.hold2 = true;
    this.maybeRelease(v);
  }

  /** Let a voice go once no pedal is still holding it. */
  private maybeRelease(v: Voice): void {
    if (!v.keydown && !v.sustained && !v.sostenuto && !v.hold2) v.dx7Note.keyup();
  }

  controlChange(ctrl: number, value: number): void {
    switch (ctrl) {
      case 1:
        this.controllers.modwheelCc = value;
        this.controllers.refresh();
        break;
      case 2:
        this.controllers.breathCc = value;
        this.controllers.refresh();
        break;
      case 4:
        this.controllers.footCc = value;
        this.controllers.refresh();
        break;
      case 5:
        this.controllers.portamentoCc = value;
        break;
      case 11:
        // Foot controller 2 (mapped to CC 11 / expression in this implementation).
        this.controllers.foot2Cc = value;
        this.controllers.foot2Seen = true;
        this.controllers.refresh();
        break;
      case 13:
        // "MIDI IN controller" (DX7II assignable CC; fixed to CC 13 here).
        this.controllers.midiCsCc = value;
        this.controllers.midiCsSeen = true;
        this.controllers.refresh();
        break;
      case 64:
        this.setSustain(value > 63);
        break;
      case 65:
        this.controllers.portamentoEnableCc = value >= 64;
        break;
      case 66:
        this.setSostenuto(value > 63);
        break;
      case 69:
        this.setHold2(value > 63);
        break;
      case 120:
      case 123:
        this.panic();
        break;
    }
  }

  setMonoMode(on: boolean): void {
    this.monoMode = on;
  }

  private setSustain(on: boolean): void {
    this.sustain = on;
    if (on) return;
    for (const v of this.voices) {
      if (!v.sustained) continue;
      v.sustained = false;
      this.maybeRelease(v);
    }
  }

  /** Sostenuto captures the keys that are down right now and holds only those. */
  private setSostenuto(on: boolean): void {
    for (const v of this.voices) {
      if (on) {
        if (v.live && v.keydown) v.sostenuto = true;
      } else if (v.sostenuto) {
        v.sostenuto = false;
        this.maybeRelease(v);
      }
    }
  }

  private setHold2(on: boolean): void {
    this.hold2 = on;
    if (on) return;
    for (const v of this.voices) {
      if (!v.hold2) continue;
      v.hold2 = false;
      this.maybeRelease(v);
    }
  }

  aftertouch(value: number): void {
    this.controllers.aftertouchCc = value;
    this.controllers.refresh();
  }

  pitchBend(value14: number): void {
    this.controllers.values_[kControllerPitch] = value14 & 0x3fff;
  }

  panic(): void {
    for (let i = 0; i < MAX_ACTIVE_NOTES; i++) {
      this.voices[i].midiNote = -1;
      this.voices[i].keydown = false;
      this.voices[i].sustained = false;
      this.voices[i].sostenuto = false;
      this.voices[i].hold2 = false;
      this.voices[i].damping = false;
      this.voices[i].live = false;
      this.voices[i].dx7Note.keyup();
      this.voices[i].dx7Note.oscSync();
    }
  }

  // ==== Shared-budget voice stealing (used by SynthRack) ====

  /** Number of voices currently producing sound and counting toward the
   * polyphony budget. Voices in a forced-damp fade are excluded - they are on
   * their way out and must not cause further steals. */
  activeVoiceCount(): number {
    let n = 0;
    for (const v of this.voices) if (v.live && !v.damping && v.dx7Note.isPlaying()) n++;
    return n;
  }

  /** This part's best steal victim: a released (key-up) voice if there is one,
   * else a held one, and the oldest within either class. */
  private stealVoice(): Voice | null {
    let best: Voice | null = null;
    for (const v of this.voices) {
      if (!v.live || v.damping || !v.dx7Note.isPlaying()) continue;
      if (
        !best ||
        (!v.keydown && best.keydown) ||
        (v.keydown === best.keydown && v.keydownSeq < best.keydownSeq)
      ) {
        best = v;
      }
    }
    return best;
  }

  /** Describes this part's steal candidate so SynthRack can rank the parts
   * against each other. Returns {seq, released} or null. */
  stealCandidate(): { seq: number; released: boolean } | null {
    const v = this.stealVoice();
    return v ? { seq: v.keydownSeq, released: !v.keydown } : null;
  }

  /** Free the steal candidate for a cross-part steal. Starts a short
   * forced-damp fade (click-free) rather than an instant cut; the slot is
   * reclaimed by the render-loop reaper once the fade completes. */
  killOldest(): void {
    const v = this.stealVoice();
    if (!v) return;
    v.keydown = false;
    v.damping = true;
    v.dx7Note.forceDamp();
  }

  // ==== Status ====

  /**
   * Current envelope/LFO state for the meters. Called from the audio thread, so
   * it fills and returns a reused object instead of allocating. Callers must read
   * the result before the next render; hold a copy if you need a snapshot.
   */
  getStatus(): PartStatus {
    let voice: Voice | null = this.voices[this.lastActiveVoice].live
      ? this.voices[this.lastActiveVoice]
      : null;
    if (!voice) {
      for (const v of this.voices) {
        if (v.live) {
          voice = v;
          break;
        }
      }
    }
    const { amps, steps, levels } = this.status;
    if (voice) {
      voice.dx7Note.peekVoiceStatus(this.peekStatus);
      for (let op = 0; op < 6; op++) {
        const a = this.peekStatus.amp[op];
        amps[op] = a > 1024 ? Math.min(1, (Math.log2(a) - 10) / 16) : 0;
        steps[op] = this.peekStatus.ampStep[op];
        levels[op] = this.peekStatus.level[op];
      }
      this.status.pitchStep = this.peekStatus.pitchStep;
      this.status.pitchLevel = this.peekStatus.pitchLevel;
    } else {
      for (let op = 0; op < 6; op++) {
        amps[op] = 0;
        steps[op] = 4;
        levels[op] = 0;
      }
      this.status.pitchStep = 4;
      this.status.pitchLevel = 0;
    }
    // Scale the LFO excursion by the delay ramp so the meter reflects the
    // modulation that actually reaches the voices.
    const ramp = this.lastLfoDelay / (1 << 24);
    this.status.lfo = 0.5 + (this.lastLfoValue / (1 << 24) - 0.5) * ramp;
    this.status.lfoRestart = this.lfoRestartSeq;
    return this.status;
  }

  /**
   * DX7II pitch bend modes (AMEM PBM): gate which live voices respond to the
   * bend wheel. NORMAL = all; LOW/HIGH = lowest/highest held note only;
   * K.ON = physically held keys only (not footswitch-sustained sound).
   */
  private updateBendGates(): void {
    const mode = this.supplement.pitchBendMode;
    if (mode === 0) {
      for (const v of this.voices) v.dx7Note.bendGate = true;
      return;
    }
    if (mode === 3) {
      for (const v of this.voices) v.dx7Note.bendGate = v.keydown;
      return;
    }
    let extreme = -1;
    for (const v of this.voices) {
      if (!v.live || !v.keydown || v.midiNote < 0) continue;
      if (extreme === -1 || (mode === 1 ? v.midiNote < extreme : v.midiNote > extreme)) {
        extreme = v.midiNote;
      }
    }
    for (const v of this.voices) {
      v.dx7Note.bendGate = v.keydown && v.midiNote === extreme;
    }
  }

  // ==== Render (mono, no FX) ====

  /** Render `numSamples` mono samples into `channelData` (overwrites). */
  render(channelData: Float32Array, numSamples: number): void {
    this.updateBendGates();
    let i = 0;

    for (i = 0; i < numSamples && i < this.extraBufSize; i++) {
      channelData[i] = this.extraBuf[i];
    }

    if (this.extraBufSize > numSamples) {
      for (let j = 0; j < this.extraBufSize - numSamples; j++) {
        this.extraBuf[j] = this.extraBuf[j + numSamples];
      }
      this.extraBufSize -= numSamples;
    } else {
      for (; i < numSamples; i += N) {
        const audiobuf = this.audiobuf;
        const sumbuf = this.sumbuf;
        audiobuf.fill(0);
        sumbuf.fill(0);

        const lfovalue = this.lfo.getsample();
        const lfodelay = this.lfo.getdelay();
        this.lastLfoValue = lfovalue;
        this.lastLfoDelay = lfodelay;

        for (let note = 0; note < MAX_ACTIVE_NOTES; note++) {
          const v = this.voices[note];
          if (v.live) {
            // Reap voices whose forced-damp fade has reached silence.
            if (v.damping && !v.dx7Note.isPlaying()) {
              v.live = false;
              v.damping = false;
              v.midiNote = -1;
              continue;
            }
            v.dx7Note.compute(audiobuf, lfovalue, lfodelay, this.controllers);
            for (let j = 0; j < N; j++) {
              const val = audiobuf[j] >> 4;
              const clipVal = val < -(1 << 24) ? 0x8000 : val >= 1 << 24 ? 0x7fff : val >> 9;
              sumbuf[j] += clipVal / 0x8000;
              audiobuf[j] = 0;
            }
          }
        }

        // DX7II controller volume (FC1/FC2/MIDI-ctrl volume ranges).
        const vol = this.controllers.volMod;
        if (vol !== 1) {
          for (let j = 0; j < N; j++) sumbuf[j] *= vol;
        }

        const jmax = numSamples - i;
        for (let j = 0; j < N; j++) {
          if (j < jmax) {
            channelData[i + j] = sumbuf[j];
          } else {
            this.extraBuf[j - jmax] = sumbuf[j];
          }
        }
      }
      this.extraBufSize = i - numSamples;
    }
  }
}
