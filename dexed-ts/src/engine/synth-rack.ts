// Multi-timbral host: up to 8 Parts sharing a global polyphony budget, mixed to
// stereo with per-part volume and pan, plus a global Dexed FX filter and master
// gain. Covers both TX802 (multi-timbral performance on one MIDI stream, parts
// split by receive channel / note range) and TX816 (8 independent DX7s, each on
// its own channel). By default only part 0 is enabled in omni mode, so a fresh
// SynthRack behaves like the single-timbre SynthUnit.

import { PluginFx } from './plugin-fx';
import { Cartridge } from './cartridge';
import { Part, EngineType } from './part';
import { initSynthTables } from './synth-unit';

export const NUM_PARTS = 8;
export const DEFAULT_POLYPHONY = 32;

export interface PartConfig {
  enabled: boolean;
  /** 0 = omni (all channels), 1..16 = specific MIDI channel. */
  rxChannel: number;
  volume: number; // 0..1
  pan: number; // -1 (hard left) .. +1 (hard right)
  noteLow: number; // 0..127 inclusive
  noteHigh: number; // 0..127 inclusive
  noteShift: number; // semitones added to engine pitch
  detune: number; // cents (stored for round-trip; audible mapping is approximate)
  /** Program number in the loaded bank this part uses (for UI / performance load). */
  voiceNumber: number;
}

function defaultPartConfig(enabled: boolean): PartConfig {
  return {
    enabled,
    rxChannel: 0,
    volume: 1,
    pan: 0,
    noteLow: 0,
    noteHigh: 127,
    noteShift: 0,
    detune: 0,
    voiceNumber: 0,
  };
}

export interface RackStatus {
  selectedPart: number;
  amps: number[];
  steps: number[];
  pitchStep: number;
  lfo: number;
  /** Active (sounding) voice count per part. */
  partActivity: number[];
  /** Total sounding voices across all parts. */
  totalActive: number;
}

export class SynthRack {
  private parts: Part[] = [];
  private configs: PartConfig[] = [];
  private fxL = new PluginFx();
  private fxR = new PluginFx();

  private polyphonyCap = DEFAULT_POLYPHONY;
  private masterGain = 0.8;
  private selected = 0;

  private scratch = new Float32Array(128);

  constructor(sampleRate: number) {
    initSynthTables(sampleRate);
    for (let i = 0; i < NUM_PARTS; i++) {
      this.parts.push(new Part());
      this.configs.push(defaultPartConfig(i === 0));
    }
    this.setSampleRate(sampleRate);
  }

  setSampleRate(sampleRate: number): void {
    initSynthTables(sampleRate);
    this.fxL.init(sampleRate);
    this.fxR.init(sampleRate);
  }

  // ==== Global config ====

  setEngineType(type: EngineType): void {
    for (const p of this.parts) p.setEngineType(type);
  }

  setPolyphonyCap(n: number): void {
    this.polyphonyCap = Math.max(1, Math.min(NUM_PARTS * 16, Math.floor(n)));
  }

  setMasterGain(gain: number): void {
    this.masterGain = gain;
  }

  setFx(cutoff: number, reso: number, gain: number): void {
    for (const fx of [this.fxL, this.fxR]) {
      fx.uiCutoff = cutoff;
      fx.uiReso = reso;
      fx.uiGain = gain;
    }
  }

  selectPart(index: number): void {
    if (index >= 0 && index < NUM_PARTS) this.selected = index;
  }

  get selectedPart(): number {
    return this.selected;
  }

  // ==== Per-part config ====

  getPartConfig(index: number): PartConfig {
    return { ...this.configs[index] };
  }

  getPartConfigs(): PartConfig[] {
    return this.configs.map((c) => ({ ...c }));
  }

  setPartConfig(index: number, patch: Partial<PartConfig>): void {
    if (index < 0 || index >= NUM_PARTS) return;
    const cfg = this.configs[index];
    Object.assign(cfg, patch);
    if (patch.noteShift !== undefined) this.parts[index].extraTranspose = cfg.noteShift;
    if (patch.enabled === false) this.parts[index].panic();
  }

  // ==== Voice / bank loading ====

  /** Load a cartridge as the shared bank for every part (TX802/TX816 style). */
  loadCartridge(cart: Cartridge): void {
    for (let i = 0; i < NUM_PARTS; i++) {
      this.parts[i].loadCartridge(cart);
      this.parts[i].setProgram(this.configs[i].voiceNumber);
    }
  }

  loadCartridgeForPart(index: number, cart: Cartridge): void {
    if (index < 0 || index >= NUM_PARTS) return;
    this.parts[index].loadCartridge(cart);
    this.parts[index].setProgram(this.configs[index].voiceNumber);
  }

  cartridgeProgramNames(): string[] {
    return this.parts[this.selected].cartridgeProgramNames();
  }

  setProgramForPart(index: number, program: number): void {
    if (index < 0 || index >= NUM_PARTS) return;
    this.configs[index].voiceNumber = program;
    this.parts[index].setProgram(program);
  }

  loadVoiceForPart(index: number, patch: Uint8Array): void {
    if (index < 0 || index >= NUM_PARTS) return;
    this.parts[index].loadVoice(patch);
  }

  setVoiceParamForPart(index: number, offset: number, value: number): void {
    if (index < 0 || index >= NUM_PARTS) return;
    this.parts[index].setVoiceParam(offset, value);
  }

  getVoiceData(index = this.selected): Uint8Array {
    return this.parts[index].getVoiceData();
  }

  // ==== MIDI routing ====

  private matches(index: number, channel: number): boolean {
    const cfg = this.configs[index];
    if (!cfg.enabled) return false;
    return cfg.rxChannel === 0 || cfg.rxChannel === channel;
  }

  private totalActiveVoices(): number {
    let n = 0;
    for (const p of this.parts) n += p.activeVoiceCount();
    return n;
  }

  /** Steal voices across all parts until there is room for `needed` more. */
  private enforceCap(needed: number): void {
    let guard = NUM_PARTS * 16 + needed;
    while (this.totalActiveVoices() + needed > this.polyphonyCap && guard-- > 0) {
      // Prefer stealing a released voice; otherwise the globally oldest keydown.
      let bestPart = -1;
      let bestSeq = Infinity;
      let bestReleased = false;
      for (let i = 0; i < NUM_PARTS; i++) {
        const cand = this.parts[i].stealCandidate();
        if (!cand) continue;
        if (
          bestPart === -1 ||
          (cand.released && !bestReleased) ||
          (cand.released === bestReleased && cand.seq < bestSeq)
        ) {
          bestPart = i;
          bestSeq = cand.seq;
          bestReleased = cand.released;
        }
      }
      if (bestPart === -1) break;
      this.parts[bestPart].killOldest();
    }
  }

  noteOn(pitch: number, velocity: number, channel = 1): void {
    if (velocity === 0) {
      this.noteOff(pitch, channel);
      return;
    }
    for (let i = 0; i < NUM_PARTS; i++) {
      if (!this.matches(i, channel)) continue;
      const cfg = this.configs[i];
      if (pitch < cfg.noteLow || pitch > cfg.noteHigh) continue;
      this.enforceCap(1);
      this.parts[i].noteOn(pitch, velocity, channel);
    }
  }

  noteOff(pitch: number, channel = 1): void {
    for (let i = 0; i < NUM_PARTS; i++) {
      if (!this.matches(i, channel)) continue;
      this.parts[i].noteOff(pitch, channel);
    }
  }

  controlChange(ctrl: number, value: number, channel = 1): void {
    for (let i = 0; i < NUM_PARTS; i++) {
      if (this.matches(i, channel)) this.parts[i].controlChange(ctrl, value);
    }
  }

  pitchBend(value14: number, channel = 1): void {
    for (let i = 0; i < NUM_PARTS; i++) {
      if (this.matches(i, channel)) this.parts[i].pitchBend(value14);
    }
  }

  aftertouch(value: number, channel = 1): void {
    for (let i = 0; i < NUM_PARTS; i++) {
      if (this.matches(i, channel)) this.parts[i].aftertouch(value);
    }
  }

  // UI-originated controllers (no MIDI channel) act on the selected part.
  controlChangeSelected(ctrl: number, value: number): void {
    this.parts[this.selected].controlChange(ctrl, value);
  }

  pitchBendSelected(value14: number): void {
    this.parts[this.selected].pitchBend(value14);
  }

  aftertouchSelected(value: number): void {
    this.parts[this.selected].aftertouch(value);
  }

  panic(): void {
    for (const p of this.parts) p.panic();
  }

  // ==== Status ====

  getStatus(): RackStatus {
    const s = this.parts[this.selected].getStatus();
    const partActivity = this.parts.map((p) => p.activeVoiceCount());
    return {
      selectedPart: this.selected,
      amps: s.amps,
      steps: s.steps,
      pitchStep: s.pitchStep,
      lfo: s.lfo,
      partActivity,
      totalActive: partActivity.reduce((a, b) => a + b, 0),
    };
  }

  // ==== Render (stereo) ====

  render(outL: Float32Array, outR: Float32Array, numSamples: number): void {
    if (this.scratch.length < numSamples) this.scratch = new Float32Array(numSamples);
    const scratch = this.scratch;
    outL.fill(0, 0, numSamples);
    outR.fill(0, 0, numSamples);

    for (let i = 0; i < NUM_PARTS; i++) {
      const cfg = this.configs[i];
      if (!cfg.enabled) continue;
      this.parts[i].render(scratch, numSamples);
      // Equal-power pan: pan -1 -> (1,0), 0 -> (~.707,~.707), +1 -> (0,1).
      const th = (cfg.pan + 1) * 0.25 * Math.PI;
      const gl = Math.cos(th) * cfg.volume;
      const gr = Math.sin(th) * cfg.volume;
      for (let j = 0; j < numSamples; j++) {
        outL[j] += scratch[j] * gl;
        outR[j] += scratch[j] * gr;
      }
    }

    this.fxL.process(outL, numSamples);
    this.fxR.process(outR, numSamples);

    const g = this.masterGain;
    for (let j = 0; j < numSamples; j++) {
      outL[j] *= g;
      outR[j] *= g;
    }
  }
}
