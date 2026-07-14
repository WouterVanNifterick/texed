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
import type { ParsedPerformance } from './performance';
import type { LoadReport } from './sysex-loader';
import type { SystemSetup } from './system-setup';
import {
  VoiceLibrary,
  defaultVoiceRef,
  voiceRefEquals,
  type VoiceRef,
  type VoiceBankId,
} from './voice-library';

export type { VoiceRef, VoiceBankId };

export const NUM_PARTS = 8;
export const DEFAULT_POLYPHONY = 32;

export function inNoteRange(pitch: number, low: number, high: number): boolean {
  return low <= high ? pitch >= low && pitch <= high : pitch <= high || pitch >= low;
}

export interface PartConfig {
  enabled: boolean;
  /** 0 = omni (all channels), 1..16 = specific MIDI channel. */
  rxChannel: number;
  volume: number;
  pan: number;
  noteLow: number;
  noteHigh: number;
  noteShift: number;
  detune: number;
  voice: VoiceRef;
  /** Resolved display name when voice is set (from loaded banks). */
  voiceLabel?: string;
  /** @deprecated Use voice.program — kept for protocol compat during migration. */
  voiceNumber?: number;
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
    voice: defaultVoiceRef(),
  };
}

export interface RackStatus {
  selectedPart: number;
  amps: number[];
  steps: number[];
  pitchStep: number;
  lfo: number;
  partActivity: number[];
  totalActive: number;
}

export interface ProgramOption {
  ref: VoiceRef;
  label: string;
}

export class SynthRack {
  private parts: Part[] = [];
  private configs: PartConfig[] = [];
  private fxL = new PluginFx();
  private fxR = new PluginFx();
  private library = new VoiceLibrary();

  private polyphonyCap = DEFAULT_POLYPHONY;
  private masterGain = 0.8;
  private selected = 0;
  private lastLoadReport: LoadReport | null = null;
  private masterTuneCents_ = 0;

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

  get voiceLibrary(): VoiceLibrary {
    return this.library;
  }

  getLoadReport(): LoadReport | null {
    return this.lastLoadReport;
  }

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

  getPartConfig(index: number): PartConfig {
    const c = this.configs[index];
    return {
      ...c,
      voice: { ...c.voice },
      voiceLabel: this.library.voiceLabel(c.voice),
    };
  }

  getPartConfigs(): PartConfig[] {
    return this.configs.map((c) => ({
      ...c,
      voice: { ...c.voice },
      voiceLabel: this.library.voiceLabel(c.voice),
    }));
  }

  setPartConfig(index: number, patch: Partial<PartConfig>): void {
    if (index < 0 || index >= NUM_PARTS) return;
    const cfg = this.configs[index];
    if (patch.voice) cfg.voice = { ...patch.voice };
    if (patch.voiceNumber !== undefined) {
      cfg.voice = { ...cfg.voice, program: patch.voiceNumber };
    }
    const { voice: _v, voiceNumber: _vn, ...rest } = patch;
    Object.assign(cfg, rest);
    if (patch.voice !== undefined || patch.voiceNumber !== undefined) {
      this.applyVoiceToPart(index);
    }
    if (patch.noteShift !== undefined) this.parts[index].extraTranspose = cfg.noteShift;
    if (patch.detune !== undefined) this.parts[index].extraDetune = cfg.detune;
    if (patch.enabled === false) this.parts[index].panic();
  }

  /** Load a full VoiceLibrary from a parsed sysex file (merges with existing data). */
  loadLibrary(lib: VoiceLibrary, report?: LoadReport): void {
    this.library.mergeFrom(lib);
    this.lastLoadReport = report ?? null;
    for (let i = 0; i < NUM_PARTS; i++) {
      this.applyVoiceToPart(i);
    }
    if (this.library.performances.length > 0) {
      this.selectPerformance(this.library.performanceIndex);
    }
  }

  /** Legacy: load a single VMEM cartridge into internalA. */
  loadCartridge(cart: Cartridge): void {
    this.library.loadLegacyCartridge(cart);
    for (let i = 0; i < NUM_PARTS; i++) {
      this.applyVoiceToPart(i);
    }
  }

  cartridgeProgramNames(): string[] {
    return this.programOptions().map((o) => o.label);
  }

  programOptions(): ProgramOption[] {
    const opts = this.library.programOptions();
    if (opts.length > 0) return opts;
    return [{ ref: defaultVoiceRef(), label: 'INIT VOICE' }];
  }

  setProgramForPart(index: number, program: number, bank?: VoiceBankId): void {
    if (index < 0 || index >= NUM_PARTS) return;
    const cfg = this.configs[index];
    cfg.voice = {
      bank: bank ?? cfg.voice.bank,
      program: program & 0x1f,
    };
    this.applyVoiceToPart(index);
  }

  setVoiceRefForPart(index: number, ref: VoiceRef): void {
    if (index < 0 || index >= NUM_PARTS) return;
    this.configs[index].voice = { bank: ref.bank, program: ref.program & 0x1f };
    this.applyVoiceToPart(index);
  }

  private applyVoiceToPart(index: number): void {
    const ref = this.configs[index].voice;
    const slot = this.library.resolve(ref);
    if (slot) {
      this.parts[index].loadVoiceSlot(slot.vmem, slot.amem);
    } else {
      this.parts[index].setProgram(ref.program);
    }
  }

  applyMasterTuneCents(cents: number): void {
    this.masterTuneCents_ = cents;
    for (const p of this.parts) p.setMasterTuneCents(cents);
  }

  get masterTuneCents(): number {
    return this.masterTuneCents_;
  }

  getSystemSetup(): SystemSetup | null {
    return this.library.systemSetup;
  }

  loadVoiceForPart(index: number, patch: Uint8Array): void {
    if (index < 0 || index >= NUM_PARTS) return;
    this.parts[index].loadVoice(patch);
  }

  loadPerformances(perfs: ParsedPerformance[]): void {
    this.library.performances = perfs;
    this.library.performanceIndex = 0;
  }

  selectPerformance(index: number): void {
    const perfs = this.library.performances;
    if (index < 0 || index >= perfs.length) return;
    this.library.performanceIndex = index;
    const { parts } = perfs[index];
    for (let i = 0; i < NUM_PARTS; i++) {
      this.setPartConfig(i, { ...defaultPartConfig(false), ...parts[i] });
    }
  }

  getPerformanceState(): { names: string[]; index: number } {
    return {
      names: this.library.performances.map((p) => p.name),
      index: this.library.performanceIndex,
    };
  }

  getBankInfos() {
    return this.library.bankInfos();
  }

  setVoiceParamForPart(index: number, offset: number, value: number): void {
    if (index < 0 || index >= NUM_PARTS) return;
    this.parts[index].setVoiceParam(offset, value);
  }

  setSupplementParamForPart(index: number, offset: number, value: number): void {
    if (index < 0 || index >= NUM_PARTS) return;
    this.parts[index].setSupplementParam(offset, value);
  }

  getVoiceData(index = this.selected): Uint8Array {
    return this.parts[index].getVoiceData();
  }

  getSupplementData(index = this.selected): Uint8Array {
    return this.parts[index].getSupplementData();
  }

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

  private enforceCap(needed: number): void {
    let guard = NUM_PARTS * 16 + needed;
    while (this.totalActiveVoices() + needed > this.polyphonyCap && guard-- > 0) {
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
      if (!inNoteRange(pitch, cfg.noteLow, cfg.noteHigh)) continue;
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

  render(outL: Float32Array, outR: Float32Array, numSamples: number): void {
    if (this.scratch.length < numSamples) this.scratch = new Float32Array(numSamples);
    const scratch = this.scratch;
    outL.fill(0, 0, numSamples);
    outR.fill(0, 0, numSamples);

    for (let i = 0; i < NUM_PARTS; i++) {
      const cfg = this.configs[i];
      if (!cfg.enabled) continue;
      this.parts[i].render(scratch, numSamples);
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

export { voiceRefEquals };
