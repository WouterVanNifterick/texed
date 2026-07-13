// 16-voice polyphonic voice manager and block renderer, ported from the DSP
// portions of Source/PluginProcessor.cpp (voice allocation, MIDI handling and
// the 64-sample block render loop with carry-over buffer).

import { N } from './synth';
import { Sin } from './sin';
import { Exp2, Tanh } from './exp2';
import { Freqlut } from './freqlut';
import { Lfo } from './lfo';
import { PitchEnv } from './pitchenv';
import { Env } from './env';
import { Porta } from './porta';
import { FmCore } from './fm-core';
import { EngineMkI } from './engine-mki';
import { EngineOpl } from './engine-opl';
import { Controllers, kControllerPitch, kControllerPitchRangeUp, kControllerPitchRangeDn, kControllerPitchStep } from './controllers';
import { Dx7Note, type VoiceStatus } from './dx7note';
import { createStandardTuning, type TuningState } from './tuning';
import { PluginFx } from './plugin-fx';
import { Cartridge, initVoice } from './cartridge';

export const MAX_ACTIVE_NOTES = 16;

export const EngineType = { Modern: 0, MarkI: 1, Opl: 2 } as const;
export type EngineType = (typeof EngineType)[keyof typeof EngineType];

let tablesInited = false;
function initTablesOnce(): void {
  if (tablesInited) return;
  Exp2.init();
  Tanh.init();
  Sin.init();
  tablesInited = true;
}

interface Voice {
  dx7Note: Dx7Note;
  midiNote: number;
  velocity: number;
  channel: number;
  keydown: boolean;
  sustained: boolean;
  live: boolean;
  keydownSeq: number;
}

export class SynthUnit {
  private tuningState: TuningState = createStandardTuning();
  private controllers = new Controllers();
  private lfo = new Lfo();
  private fx = new PluginFx();

  private engines: FmCore[];

  private voices: Voice[] = [];
  private data = initVoice(); // current unpacked voice (156 bytes)
  private cartridge: Cartridge | null = null;

  private currentNote = 0;
  private nextKeydownSeq = 0;
  private lastActiveVoice = 0;
  private sustain = false;

  private lastLfoValue = 0;
  private peekStatus: VoiceStatus = { amp: [0, 0, 0, 0, 0, 0], ampStep: [0, 0, 0, 0, 0, 0], pitchStep: 0 };

  private extraBuf = new Float32Array(N);
  private extraBufSize = 0;
  private audiobuf = new Int32Array(N);
  private sumbuf = new Float32Array(N);

  constructor(sampleRate: number) {
    initTablesOnce();

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
        live: false,
        keydownSeq: -1,
      });
    }

    this.setSampleRate(sampleRate);

    this.controllers.values_[kControllerPitch] = 0x2000;
    this.controllers.values_[kControllerPitchRangeUp] = 3;
    this.controllers.values_[kControllerPitchRangeDn] = 3;
    this.controllers.values_[kControllerPitchStep] = 0;
    this.controllers.masterTune = 0;
    // Default mod-source routing. Stock Dexed leaves all of these unassigned
    // (range 0), so the mod wheel etc. are received but inaudible until the
    // user configures them in the "Cntlr" dialog. Since this port has no such
    // UI, wire up the canonical DX7 defaults so the controllers do something:
    // the mod wheel adds pitch-LFO (vibrato) and aftertouch adds amplitude-LFO,
    // each still scaled by the current patch's LFO sensitivities.
    this.controllers.wheel.range = 99;
    this.controllers.wheel.pitch = true;
    this.controllers.at.range = 99;
    this.controllers.at.amp = true;
    this.controllers.refresh();

    this.lfo.reset(this.data.subarray(137));
  }

  setSampleRate(sampleRate: number): void {
    Freqlut.init(sampleRate);
    Lfo.init(sampleRate);
    PitchEnv.init(sampleRate);
    Env.initSr(sampleRate);
    Porta.initSr(sampleRate);
    this.fx.init(sampleRate);
  }

  setEngineType(type: EngineType): void {
    this.controllers.core = this.engines[type] ?? this.engines[EngineType.MarkI];
  }

  get fxParams(): PluginFx {
    return this.fx;
  }

  /** Load a raw unpacked 156-byte voice and refresh live voices. */
  loadVoice(patch: Uint8Array): void {
    this.data.set(patch.subarray(0, 156));
    this.refreshVoices();
  }

  /** Set a single byte of the current voice and refresh live voices. */
  setVoiceParam(offset: number, value: number): void {
    if (offset < 0 || offset > 155) return;
    this.data[offset] = value;
    this.refreshVoices();
  }

  getVoiceData(): Uint8Array {
    return this.data.slice();
  }

  loadCartridge(cart: Cartridge): void {
    this.cartridge = cart;
  }

  cartridgeProgramNames(): string[] {
    return this.cartridge ? this.cartridge.programNames() : [];
  }

  setProgram(idx: number): void {
    if (!this.cartridge) return;
    const patch = this.cartridge.unpackProgram(idx);
    this.data.set(patch);
    this.refreshVoices();
  }

  private refreshVoices(): void {
    let sw = '';
    for (let op = 0; op < 6; op++) {
      sw += this.data[155] & (1 << op) ? '1' : '0';
    }
    this.controllers.opSwitch = sw;
    for (let i = 0; i < MAX_ACTIVE_NOTES; i++) {
      if (this.voices[i].live) {
        this.voices[i].dx7Note.update(
          this.data,
          this.voices[i].midiNote,
          this.voices[i].velocity,
          this.voices[i].channel,
        );
      }
    }
    this.lfo.reset(this.data.subarray(137));
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

  noteOn(pitch: number, velocity: number, channel = 1): void {
    if (velocity === 0) {
      this.noteOff(pitch, channel);
      return;
    }

    let triggerLfo = true;
    for (let i = 0; i < MAX_ACTIVE_NOTES; i++) {
      if (this.voices[i].keydown) {
        triggerLfo = false;
        break;
      }
    }
    if (triggerLfo) this.lfo.keydown();

    const note = this.chooseNote(pitch);
    this.currentNote = (note + 1) % MAX_ACTIVE_NOTES;
    const v = this.voices[note];
    v.channel = channel;
    v.midiNote = pitch;
    v.velocity = velocity;
    v.sustained = this.sustain;
    v.keydown = true;
    v.keydownSeq = this.nextKeydownSeq++;

    const voiceSteal = v.dx7Note.isPlaying();
    v.dx7Note.init(this.data, pitch, velocity, channel);
    if (this.data[136] && !voiceSteal) {
      v.dx7Note.oscSync();
    }
    if (
      this.voices[this.lastActiveVoice].midiNote !== -1 &&
      this.controllers.portamentoEnableCc &&
      this.controllers.portamentoCc > 0
    ) {
      v.dx7Note.initPortamento(this.voices[this.lastActiveVoice].dx7Note);
    }

    if (!this.data[136]) {
      // transfer phase from another voice playing the same pitch
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
    let note: number;
    for (note = 0; note < MAX_ACTIVE_NOTES; note++) {
      if (this.voices[note].midiNote === pitch && this.voices[note].keydown && this.voices[note].channel === channel) {
        this.voices[note].keydown = false;
        break;
      }
    }
    if (note >= MAX_ACTIVE_NOTES) {
      // fall back: match by pitch regardless of channel
      for (note = 0; note < MAX_ACTIVE_NOTES; note++) {
        if (this.voices[note].midiNote === pitch && this.voices[note].keydown) {
          this.voices[note].keydown = false;
          break;
        }
      }
      if (note >= MAX_ACTIVE_NOTES) return;
    }

    if (this.sustain) {
      this.voices[note].sustained = true;
    } else {
      this.voices[note].dx7Note.keyup();
    }
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
      case 64:
        this.setSustain(value > 63);
        break;
      case 65:
        this.controllers.portamentoEnableCc = value >= 64;
        break;
      case 120:
      case 123:
        this.panic();
        break;
    }
  }

  private setSustain(on: boolean): void {
    this.sustain = on;
    if (!on) {
      for (let note = 0; note < MAX_ACTIVE_NOTES; note++) {
        if (this.voices[note].sustained && !this.voices[note].keydown) {
          this.voices[note].dx7Note.keyup();
          this.voices[note].sustained = false;
        }
      }
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
      this.voices[i].live = false;
      this.voices[i].dx7Note.oscSync();
    }
  }

  // ==== Status (UI visualization) ====

  /**
   * Per-operator envelope level (0..1) and stage (0..4) of the most recent
   * live voice, plus the pitch EG stage and current LFO level (0..1).
   */
  getStatus(): { amps: number[]; steps: number[]; pitchStep: number; lfo: number } {
    let voice: Voice | null = this.voices[this.lastActiveVoice].live ? this.voices[this.lastActiveVoice] : null;
    if (!voice) {
      for (const v of this.voices) {
        if (v.live) {
          voice = v;
          break;
        }
      }
    }
    const amps = [0, 0, 0, 0, 0, 0];
    const steps = [4, 4, 4, 4, 4, 4];
    let pitchStep = 4;
    if (voice) {
      voice.dx7Note.peekVoiceStatus(this.peekStatus);
      for (let op = 0; op < 6; op++) {
        // amp is 2^((levelIn/2^24) - 14) in Q24; map its exponent to 0..1.
        const a = this.peekStatus.amp[op];
        amps[op] = a > 1024 ? Math.min(1, (Math.log2(a) - 10) / 16) : 0;
        steps[op] = this.peekStatus.ampStep[op];
      }
      pitchStep = this.peekStatus.pitchStep;
    }
    return { amps, steps, pitchStep, lfo: this.lastLfoValue / (1 << 24) };
  }

  // ==== Render ====

  /** Render `numSamples` mono samples into `channelData`. */
  render(channelData: Float32Array, numSamples: number): void {
    let i = 0;

    // flush carry-over from a previous block
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

        for (let note = 0; note < MAX_ACTIVE_NOTES; note++) {
          if (this.voices[note].live) {
            this.voices[note].dx7Note.compute(audiobuf, lfovalue, lfodelay, this.controllers);
            for (let j = 0; j < N; j++) {
              let val = audiobuf[j];
              val = val >> 4;
              const clipVal = val < -(1 << 24) ? 0x8000 : val >= 1 << 24 ? 0x7fff : val >> 9;
              let f = clipVal / 0x8000;
              if (f > 1) f = 1;
              if (f < -1) f = -1;
              sumbuf[j] += f;
              audiobuf[j] = 0;
            }
          }
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

    this.fx.process(channelData, numSamples);
  }
}
