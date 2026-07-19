// Multi-timbral host: up to 8 Parts sharing a global polyphony budget, mixed to
// stereo with per-part volume and pan, plus a global Dexed FX filter and master
// gain. Covers both TX802 (multi-timbral performance on one MIDI stream, parts
// split by receive channel / note range) and TX816 (8 independent DX7s, each on
// its own channel). By default only part 0 is enabled in omni mode, so a fresh
// SynthRack behaves like the single-timbre SynthUnit.

import { PluginFx } from './plugin-fx';
import { Part, EngineType } from './part';
import { initSynthTables } from './synth-unit';
import type { ParsedPerformance } from '@texed/dx7-format/performance';
import type { LoadReport } from '@texed/dx7-format/sysex-loader';
import type { RackState } from '@texed/dx7-format/rack-state';
import { RACK_STATE_SCHEMA } from '@texed/dx7-format/rack-state';
import { identifySysex, SysexKind, cartridgeFromSyx } from '@texed/dx7-format/sysex';
import { amemPayloadFromFrame } from '@texed/dx7-format/amem';
import {
  VoiceLibrary,
  defaultVoiceRef,
  voiceRefEquals,
  type VoiceRef,
  type VoiceBankId,
} from '@texed/dx7-format/voice-library';

import {
  NUM_PARTS,
  defaultPartConfig,
  inNoteRange,
  type PartConfig,
  type ProgramOption,
} from '@texed/dx7-format/part-config';

export type { VoiceRef, VoiceBankId, PartConfig, ProgramOption };
export { NUM_PARTS, inNoteRange };

export const DEFAULT_POLYPHONY = 32;

/** Deep-copy parsed performances so snapshots never alias live library state. */
function copyPerformances(perfs: ParsedPerformance[]): ParsedPerformance[] {
  return perfs.map((p) => ({
    name: p.name,
    parts: p.parts.map((part) => ({
      ...part,
      ...(part.voice ? { voice: { ...part.voice } } : {}),
    })),
  }));
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
    const { voice: _v, ...rest } = patch;
    Object.assign(cfg, rest);
    if (patch.voice !== undefined) {
      this.applyVoiceToPart(index);
    }
    if (patch.noteShift !== undefined) this.parts[index].extraTranspose = cfg.noteShift;
    if (patch.detune !== undefined) this.parts[index].extraDetune = cfg.detune;
    if (patch.forcedDamp !== undefined) this.parts[index].forcedDamp = cfg.forcedDamp;
    if (patch.enabled === false) this.parts[index].panic();
    // Keep the link group consistent after any change to a member (including a
    // link toggle, which can move `index` into or out of a group).
    this.syncLinkedSlaves(this.masterIndexOf(index));
  }

  /** Load a full VoiceLibrary from a parsed sysex file (merges with existing data). */
  loadLibrary(lib: VoiceLibrary, report?: LoadReport): void {
    this.library.mergeFrom(lib);
    this.lastLoadReport = report ?? null;
    for (let i = 0; i < NUM_PARTS; i++) {
      this.applyVoiceToPart(i);
    }
    for (let i = 0; i < NUM_PARTS; i++) {
      if (!this.isSlave(i)) this.syncLinkedSlaves(i);
    }
    if (this.library.performances.length > 0) {
      this.selectPerformance(this.library.performanceIndex);
    }
  }

  programOptions(): ProgramOption[] {
    const opts = this.library.programOptions();
    if (opts.length > 0) return opts;
    return [{ ref: defaultVoiceRef(), label: 'INIT VOICE' }];
  }

  setVoiceRefForPart(index: number, ref: VoiceRef): void {
    if (index < 0 || index >= NUM_PARTS) return;
    this.configs[index].voice = { bank: ref.bank, program: ref.program & 0x1f };
    this.applyVoiceToPart(index);
    this.syncLinkedSlaves(this.masterIndexOf(index));
  }

  private applyVoiceToPart(index: number): void {
    const ref = this.configs[index].voice;
    const slot = this.library.resolve(ref);
    if (slot) {
      this.parts[index].loadVoiceSlot(slot.vmem, slot.amem);
    } else {
      // Bank not loaded: keep the current voice data but silence held notes,
      // matching the behavior of a program change.
      this.parts[index].clearActiveVoices();
    }
  }

  applyMasterTuneCents(cents: number): void {
    this.masterTuneCents_ = cents;
    for (const p of this.parts) p.setMasterTuneCents(cents);
  }

  get masterTuneCents(): number {
    return this.masterTuneCents_;
  }

  loadVoiceForPart(index: number, patch: Uint8Array, supplement?: Uint8Array): void {
    if (index < 0 || index >= NUM_PARTS) return;
    if (supplement) this.parts[index].loadVoiceSlot(patch, supplement);
    else this.parts[index].loadVoice(patch);
  }

  /** Replace one half-bank with unpacked voices and re-apply parts using it. */
  loadBankInto(bank: VoiceBankId, voices: Uint8Array[], amems?: Uint8Array[]): void {
    this.library.loadVoicesInto(bank, voices, amems);
    for (let i = 0; i < NUM_PARTS; i++) {
      if (this.configs[i].voice.bank === bank) this.applyVoiceToPart(i);
    }
    for (let i = 0; i < NUM_PARTS; i++) {
      if (!this.isSlave(i)) this.syncLinkedSlaves(i);
    }
  }

  /** Snapshot the whole rack for persistence (banks as SysEx dumps). */
  getFullState(): RackState {
    const banks: RackState['banks'] = [];
    for (const id of this.library.populatedBanks()) {
      const data = this.library.dumpBankSysex(id);
      if (data) banks.push({ id, data });
    }
    return {
      schema: RACK_STATE_SCHEMA,
      banks,
      performances: copyPerformances(this.library.performances),
      performanceIndex: this.library.performanceIndex,
      parts: this.configs.map((c) => ({ ...c, voice: { ...c.voice } })),
      selectedPart: this.selected,
      masterTuneCents: this.masterTuneCents_,
      editBuffers: this.parts.map((p) => ({
        voice: p.getVoiceData(),
        supplement: p.getSupplementData(),
      })),
    };
  }

  /** Restore a getFullState snapshot. Throws on schema mismatch or bad data. */
  restoreFullState(state: RackState): void {
    if (!state || state.schema !== RACK_STATE_SCHEMA) {
      throw new Error('unsupported rack state schema');
    }
    this.library.clear();
    for (const b of state.banks) {
      for (const frame of identifySysex(b.data)) {
        if (frame.kind === SysexKind.Amem) {
          const packed = amemPayloadFromFrame(frame.raw);
          if (packed) this.library.loadAmemBank(b.id, packed);
        } else if (frame.kind === SysexKind.Cartridge) {
          const cart = cartridgeFromSyx(frame.raw);
          if (cart) this.library.loadVmemBank(b.id, cart);
        }
      }
    }
    this.library.performances = copyPerformances(state.performances);
    this.library.performanceIndex = Math.max(
      0,
      Math.min(state.performances.length - 1, state.performanceIndex),
    );
    for (let i = 0; i < NUM_PARTS; i++) {
      const src = state.parts[i];
      const { voiceLabel: _label, ...cfg } = src ?? defaultPartConfig(i === 0);
      this.setPartConfig(i, cfg);
    }
    if (state.selectedPart >= 0 && state.selectedPart < NUM_PARTS) {
      this.selected = state.selectedPart;
    }
    this.applyMasterTuneCents(state.masterTuneCents);
    // Edit buffers last so unsaved edits win over the bank slot contents.
    state.editBuffers?.forEach((eb, i) => {
      if (i < NUM_PARTS && eb?.voice?.length >= 156 && eb?.supplement?.length >= 35) {
        this.parts[i].loadVoiceSlot(eb.voice, eb.supplement);
      }
    });
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
    // setPartConfig already syncs per index, but a later master edit can precede
    // its slaves being marked linked; re-sync every group once all parts are set.
    for (let i = 0; i < NUM_PARTS; i++) {
      if (!this.isSlave(i)) this.syncLinkedSlaves(i);
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

  /**
   * Commit the selected part's edit buffer into a bank slot (defaults to the
   * part's currently-assigned voice ref). Edits are otherwise ephemeral and
   * lost on the next program change / performance reselect.
   */
  storeSelectedVoice(dest?: VoiceRef): void {
    const part = this.parts[this.selected];
    const ref = dest ?? this.configs[this.selected].voice;
    this.library.storeVoice(ref, part.getVoiceData(), part.getSupplementData());
  }

  getVoiceData(index = this.selected): Uint8Array {
    return this.parts[index].getVoiceData();
  }

  getSupplementData(index = this.selected): Uint8Array {
    return this.parts[index].getSupplementData();
  }

  /** A part is a linked slave when it (and only it) carries the link flag; part 0
   * can never be a slave since it has no part above to chain to. */
  private isSlave(index: number): boolean {
    return index > 0 && this.configs[index].link;
  }

  /** The master (non-linked) part that heads `index`'s link chain. */
  private masterIndexOf(index: number): number {
    let i = index;
    while (i > 0 && this.configs[i].link) i--;
    return i;
  }

  /** A master's group: itself followed by the contiguous run of linked slaves. */
  private groupMembers(master: number): number[] {
    const members = [master];
    for (let i = master + 1; i < NUM_PARTS && this.configs[i].link; i++) {
      members.push(i);
    }
    return members;
  }

  /** Copy a master's authoritative config onto its linked slaves so a group acts
   * as one instrument. Slave rows are never authoritative, preventing drift. */
  private syncLinkedSlaves(master: number): void {
    if (this.isSlave(master)) return;
    const m = this.configs[master];
    for (let i = master + 1; i < NUM_PARTS && this.configs[i].link; i++) {
      const s = this.configs[i];
      const wasEnabled = s.enabled;
      s.enabled = m.enabled;
      if (!voiceRefEquals(s.voice, m.voice)) {
        s.voice = { ...m.voice };
        this.applyVoiceToPart(i);
      }
      this.parts[i].forcedDamp = m.forcedDamp;
      if (wasEnabled && !s.enabled) this.parts[i].panic();
    }
  }

  private matches(index: number, channel: number): boolean {
    const cfg = this.configs[index];
    if (!cfg.enabled) return false;
    // Slaves never match independently; they follow their master's routing.
    if (this.isSlave(index)) return false;
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
      // Route to the least-busy member of the link group so a linked instrument
      // fills its combined voice pools (extended polyphony).
      const members = this.groupMembers(i);
      let target = i;
      let fewest = this.parts[i].activeVoiceCount();
      for (let k = 1; k < members.length; k++) {
        const n = this.parts[members[k]].activeVoiceCount();
        if (n < fewest) {
          fewest = n;
          target = members[k];
        }
      }
      this.parts[target].noteOn(pitch, velocity, channel);
    }
  }

  noteOff(pitch: number, channel = 1): void {
    for (let i = 0; i < NUM_PARTS; i++) {
      if (!this.matches(i, channel)) continue;
      // The note may live in any group pool, so release across all members.
      for (const m of this.groupMembers(i)) this.parts[m].noteOff(pitch, channel);
    }
  }

  controlChange(ctrl: number, value: number, channel = 1): void {
    for (let i = 0; i < NUM_PARTS; i++) {
      if (!this.matches(i, channel)) continue;
      for (const m of this.groupMembers(i)) this.parts[m].controlChange(ctrl, value);
    }
  }

  pitchBend(value14: number, channel = 1): void {
    for (let i = 0; i < NUM_PARTS; i++) {
      if (!this.matches(i, channel)) continue;
      for (const m of this.groupMembers(i)) this.parts[m].pitchBend(value14);
    }
  }

  aftertouch(value: number, channel = 1): void {
    for (let i = 0; i < NUM_PARTS; i++) {
      if (!this.matches(i, channel)) continue;
      for (const m of this.groupMembers(i)) this.parts[m].aftertouch(value);
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
      // A linked slave is voiced by its master's volume/pan/enabled so the group
      // mixes as a single instrument.
      const cfg = this.configs[this.masterIndexOf(i)];
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
