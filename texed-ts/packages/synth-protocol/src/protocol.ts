// Transport-agnostic control protocol for a Texed synth: commands the host
// sends and events the synth emits. Carried over an AudioWorklet MessagePort
// today; the same messages fit a hardware-MIDI or native (JUCE) bridge.

import type { PartConfig, ProgramOption } from '@texed/dx7-format/part-config';
import type { VoiceRef, VoiceBankId } from '@texed/dx7-format/voice-library';
import type { LoadReport } from '@texed/dx7-format/sysex-loader';
import type { RackState } from '@texed/dx7-format/rack-state';
import type { GlobalSettings } from '@texed/dx7-format/global-settings';

export type { VoiceRef, VoiceBankId, RackState, GlobalSettings };

export const MsgType = {
  NoteOn: 'noteOn',
  NoteOff: 'noteOff',
  Cc: 'cc',
  ProgramChange: 'programChange',
  PitchBend: 'pitchBend',
  Aftertouch: 'aftertouch',
  Sysex: 'sysex',
  LoadVoice: 'loadVoice',
  LoadCart: 'loadCart',
  SetVoiceRef: 'setVoiceRef',
  SetEngine: 'setEngine',
  SetAccuracy: 'setAccuracy',
  SetVolume: 'setVolume',
  SetParam: 'setParam',
  SetSupplementParam: 'setSupplementParam',
  SetGlobal: 'setGlobal',
  SetMasterTune: 'setMasterTune',
  SetMicrotuning: 'setMicrotuning',
  Panic: 'panic',
  SelectPart: 'selectPart',
  SetPart: 'setPart',
  SetPolyphonyCap: 'setPolyphonyCap',
  SelectPerformance: 'selectPerformance',
  LoadPerformance: 'loadPerformance',
  RequestBankDump: 'requestBankDump',
  StoreVoice: 'storeVoice',
  LoadBankInto: 'loadBankInto',
  GetFullState: 'getFullState',
  SetFullState: 'setFullState',
  ParamGesture: 'paramGesture',
} as const;

export interface NoteOnMsg {
  type: typeof MsgType.NoteOn;
  note: number;
  velocity: number;
  channel?: number;
}
export interface NoteOffMsg {
  type: typeof MsgType.NoteOff;
  note: number;
  channel?: number;
}
export interface CcMsg {
  type: typeof MsgType.Cc;
  controller: number;
  value: number;
  channel?: number;
}
export interface ProgramChangeMsg {
  type: typeof MsgType.ProgramChange;
  program: number;
  channel?: number;
}
/** One incoming SysEx frame from a MIDI port: a live edit, or a bulk dump. */
export interface SysexMsg {
  type: typeof MsgType.Sysex;
  data: ArrayBuffer;
}
export interface PitchBendMsg {
  type: typeof MsgType.PitchBend;
  value: number; // 14-bit 0..16383
  channel?: number;
}
export interface AftertouchMsg {
  type: typeof MsgType.Aftertouch;
  value: number;
  channel?: number;
}
export interface LoadVoiceMsg {
  type: typeof MsgType.LoadVoice;
  data: ArrayBuffer; // 156 bytes
  /** Optional 35-byte DX7II AMEM supplement to load with the voice. */
  supplement?: ArrayBuffer;
  /** Target part; defaults to the selected part. */
  partIndex?: number;
}
export interface LoadCartMsg {
  type: typeof MsgType.LoadCart;
  data: ArrayBuffer; // raw .syx bytes
}
export interface SetVoiceRefMsg {
  type: typeof MsgType.SetVoiceRef;
  voice: VoiceRef;
  partIndex?: number;
}
export interface SelectPartMsg {
  type: typeof MsgType.SelectPart;
  index: number;
}
export interface SetPartMsg {
  type: typeof MsgType.SetPart;
  index: number;
  config: Partial<PartConfig>;
}
export interface SetPolyphonyCapMsg {
  type: typeof MsgType.SetPolyphonyCap;
  cap: number;
}
export interface SelectPerformanceMsg {
  type: typeof MsgType.SelectPerformance;
  index: number;
}
/** Load a full performance into the edit buffers from a non-library source
 * (e.g. a MiniDexed .ini). Populates 8 part configs + voice buffers and sets
 * the performance name; the library performance index becomes -1. */
export interface LoadPerformanceMsg {
  type: typeof MsgType.LoadPerformance;
  name: string;
  parts: Partial<PartConfig>[];
  /** 8 entries; each a 156-byte unpacked voice, or null to leave that part's buffer. */
  voices: (Uint8Array | null)[];
}
export interface SetEngineMsg {
  type: typeof MsgType.SetEngine;
  engine: number; // EngineType
}
export interface SetAccuracyMsg {
  type: typeof MsgType.SetAccuracy;
  accuracy: GlobalSettings['accuracy'];
}
export interface SetVolumeMsg {
  type: typeof MsgType.SetVolume;
  volume: number; // 0..99 knob; engine applies the perceptual taper
}
export interface SetParamMsg {
  type: typeof MsgType.SetParam;
  offset: number; // byte offset into the 156-byte voice
  value: number;
}
export interface SetSupplementParamMsg {
  type: typeof MsgType.SetSupplementParam;
  offset: number; // byte offset into the 35-byte AMEM supplement
  value: number;
}
/** Apply part of the global settings block. Fields left out keep their value,
 * so this doubles as the setter for the compressor switch and reverb block. */
export interface SetGlobalMsg {
  type: typeof MsgType.SetGlobal;
  settings: Partial<GlobalSettings>;
}
export interface SetMasterTuneMsg {
  type: typeof MsgType.SetMasterTune;
  cents: number;
}
export interface SetMicrotuningMsg {
  type: typeof MsgType.SetMicrotuning;
  index: number; // into the loaded micro-tuning tables, or -1 for standard tuning
}
export interface PanicMsg {
  type: typeof MsgType.Panic;
}
export interface RequestBankDumpMsg {
  type: typeof MsgType.RequestBankDump;
  bank: VoiceBankId;
}
export interface StoreVoiceMsg {
  type: typeof MsgType.StoreVoice;
  /** Destination slot; defaults to the selected part's current voice ref. */
  dest?: VoiceRef;
}
export interface LoadBankIntoMsg {
  type: typeof MsgType.LoadBankInto;
  bank: VoiceBankId;
  /** Up to 32 × 156-byte unpacked voices, concatenated; short data is init-padded. */
  voices: ArrayBuffer;
  /** Optional matching 35-byte AMEM supplements, concatenated. */
  supplements?: ArrayBuffer;
}
export interface GetFullStateMsg {
  type: typeof MsgType.GetFullState;
}
export interface SetFullStateMsg {
  type: typeof MsgType.SetFullState;
  state: RackState;
}
/**
 * Bracket a drag of one part field. A plugin host needs this to record touch
 * automation and to know not to echo the value back mid-drag; a synth that
 * owns its own state ignores it.
 */
export interface ParamGestureMsg {
  type: typeof MsgType.ParamGesture;
  index: number;
  field: keyof PartConfig;
  begin: boolean;
}

export type SynthCommand =
  | NoteOnMsg
  | NoteOffMsg
  | CcMsg
  | ProgramChangeMsg
  | SysexMsg
  | PitchBendMsg
  | AftertouchMsg
  | LoadVoiceMsg
  | LoadCartMsg
  | SetVoiceRefMsg
  | SetEngineMsg
  | SetAccuracyMsg
  | SetVolumeMsg
  | SetGlobalMsg
  | SetParamMsg
  | SetSupplementParamMsg
  | SetMasterTuneMsg
  | SetMicrotuningMsg
  | PanicMsg
  | SelectPartMsg
  | SetPartMsg
  | SetPolyphonyCapMsg
  | SelectPerformanceMsg
  | LoadPerformanceMsg
  | RequestBankDumpMsg
  | StoreVoiceMsg
  | LoadBankIntoMsg
  | GetFullStateMsg
  | SetFullStateMsg
  | ParamGestureMsg;

export interface ProgramStateMsg {
  type: 'programState';
  options: ProgramOption[];
  banks: { id: VoiceBankId; label: string; populated: boolean }[];
}
export interface LoadReportMsg {
  type: 'loadReport';
  report: LoadReport;
}
/** Full current voice, sent after program/cartridge/voice loads. */
export interface VoiceMsg {
  type: 'voice';
  data: Uint8Array; // 156 bytes
  supplement: Uint8Array; // 35-byte DX7II AMEM supplement
}
/** Current global system-setup settings (engine, volume, polyphony, master
 * tune), sent after loads/session restore and any settings change. */
export interface SettingsMsg {
  type: 'settings';
  settings: GlobalSettings;
  /** Display names of the loaded micro-tuning tables (for the selector UI). */
  microtuningNames: string[];
}
/** Periodic realtime status for UI meters (~30 Hz). */
export interface StatusMsg {
  type: 'status';
  amps: number[]; // per-op envelope output 0..1, sysex op order
  steps: number[]; // per-op envelope stage 0..4
  levels: number[]; // per-op raw Q24 amp-envelope level (maps onto the plotted curve)
  pitchStep: number;
  pitchLevel: number; // raw Q24-per-octave pitch-envelope level
  lfo: number; // 0..1
  lfoRestart: number; // increments each time the LFO is (re)triggered
  selectedPart: number;
  partActivity: number[]; // sounding voice count per part
  totalActive: number;
}

/** Per-part rack configuration + selection, sent after any part change. */
export interface PartsMsg {
  type: 'parts';
  configs: PartConfig[];
  selectedPart: number;
  /** Voice name in each part's edit buffer (live voice, not the library slot). */
  voiceNames: string[];
}

export interface PerformancesMsg {
  type: 'performances';
  names: string[];
  /** Selected library performance, or -1 when loaded from a file. */
  index: number;
  /** Display name of the currently loaded performance (edit-buffer identity). */
  name: string;
}

/** Serialized AMEM + VMEM SysEx for one bank half (response to RequestBankDump). */
export interface BankDumpMsg {
  type: 'bankDump';
  bank: VoiceBankId;
  /** Concatenated AMEM (0x06) + VMEM (0x09) frames, or null if bank empty. */
  data: Uint8Array | null;
}

/** Whole-rack snapshot (response to GetFullState). */
export interface FullStateMsg {
  type: 'fullState';
  state: RackState;
}

/**
 * Raw MIDI the synth received but cannot read on its own. The JUCE plugin
 * forwards bulk dumps, program change and bank select this way, because
 * reading them needs the format code and the voice library, both of which
 * live here rather than in C++.
 */
export interface MidiMsg {
  type: 'midi';
  data: Uint8Array;
}

export type SynthEvent =
  | ProgramStateMsg
  | LoadReportMsg
  | VoiceMsg
  | SettingsMsg
  | StatusMsg
  | PartsMsg
  | PerformancesMsg
  | BankDumpMsg
  | FullStateMsg
  | MidiMsg;
