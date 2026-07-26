// The shape of the synth as the UI sees it: actions that mutate the rack, and
// the main-thread mirror that components render from.

import type { StatusMsg, RackState } from '@texed/synth-protocol/protocol';
import type { PartConfig, ProgramOption } from '@texed/dx7-format/part-config';
import type { VoiceRef, VoiceBankId } from '@texed/dx7-format/voice-library';
import type { LoadReport } from '@texed/dx7-format/sysex-loader';
import type { GlobalSettings } from '@texed/dx7-format/global-settings';

export type SynthStatus = Omit<StatusMsg, 'type'>;

export interface BankInfo {
  id: VoiceBankId;
  label: string;
  populated: boolean;
}

/**
 * Everything that mutates the rack or reads it back asynchronously. Every member
 * is stable for the lifetime of the hook, so these are safe as effect
 * dependencies and as props to memoized components.
 */
export interface SynthActions {
  start: () => Promise<void>;
  noteOn: (note: number, velocity: number, channel?: number) => void;
  noteOff: (note: number, channel?: number) => void;
  controlChange: (controller: number, value: number, channel?: number) => void;
  pitchBend: (value: number, channel?: number) => void;
  aftertouch: (value: number, channel?: number) => void;
  panic: () => void;
  setEngine: (engine: number) => void;
  setProgram: (index: number) => void;
  setVoiceRef: (ref: VoiceRef, partIndex?: number) => void;
  loadCart: (data: ArrayBuffer) => void;
  setParam: (offset: number, value: number) => void;
  setSupplementParam: (offset: number, value: number) => void;
  setMasterTune: (cents: number) => void;
  /** Select the active micro-tuning (-1 = standard tuning). */
  setMicrotuning: (index: number) => void;
  setVoice: (voice: Uint8Array, opts?: { supplement?: Uint8Array; partIndex?: number }) => void;
  setVolume: (volume: number) => void;
  selectPart: (index: number) => void;
  setPart: (index: number, config: Partial<PartConfig>) => void;
  setPolyphonyCap: (cap: number) => void;
  selectPerformance: (index: number) => void;
  /** Load a full performance (8 parts + voices) into the edit buffers from a
   * non-library source (e.g. a MiniDexed .ini); sets `performanceName`. */
  loadPerformance: (
    name: string,
    parts: Partial<PartConfig>[],
    voices: (Uint8Array | null)[],
  ) => void;
  subscribeStatus: (cb: (s: SynthStatus) => void) => () => void;
  /** Request a bank half as SysEx; cb gets null when the bank is empty. */
  requestBankDump: (bank: VoiceBankId, cb: (data: Uint8Array | null) => void) => void;
  /** Commit the selected part's edit buffer into a voice slot (defaults to its current voice ref). */
  storeVoice: (dest?: VoiceRef) => void;
  /** Replace one half-bank with concatenated 156-byte voices (+ optional 35-byte AMEMs). */
  loadBankInto: (bank: VoiceBankId, voices: Uint8Array, supplements?: Uint8Array) => void;
  /** Snapshot the whole rack (banks, performances, parts, edit buffers). */
  getFullState: (cb: (state: RackState) => void) => void;
  /** Restore a getFullState snapshot. */
  setFullState: (state: RackState) => void;
}

/** The main-thread mirror of the rack. Each member changes as the rack changes. */
export interface SynthData {
  programOptions: ProgramOption[];
  /** The four half-banks with populated flags (mirrors the worklet library). */
  banks: BankInfo[];
  loadReport: LoadReport | null;
  voice: Uint8Array;
  /** 35-byte DX7II AMEM supplement for the selected part's voice. */
  supplement: Uint8Array;
  /** Global system-setup settings (engine, volume, polyphony, master tune, micro-tuning). */
  settings: GlobalSettings;
  /** Display names of loaded micro-tuning tables; index maps to settings.microtuning. */
  microtuningNames: string[];
  partConfigs: PartConfig[];
  /** Voice name in each part's edit buffer (live voice, not the library slot). */
  partVoiceNames: string[];
  selectedPart: number;
  performanceNames: string[];
  /** Selected library performance, or -1 when loaded from a file. */
  performanceIndex: number;
  /** Display name of the currently loaded performance (edit-buffer identity). */
  performanceName: string;
}

export interface Synth extends SynthActions, SynthData {}
