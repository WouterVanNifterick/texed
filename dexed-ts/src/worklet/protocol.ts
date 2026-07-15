// Message protocol between the main thread and the Dexed AudioWorklet.

import type { PartConfig, ProgramOption } from '../engine/synth-rack';
import type { VoiceRef, VoiceBankId } from '../engine/voice-library';
import type { LoadReport } from '../engine/sysex-loader';

export type { VoiceRef, VoiceBankId };

export const MsgType = {
  NoteOn: 'noteOn',
  NoteOff: 'noteOff',
  Cc: 'cc',
  PitchBend: 'pitchBend',
  Aftertouch: 'aftertouch',
  LoadVoice: 'loadVoice',
  LoadCart: 'loadCart',
  SetVoiceRef: 'setVoiceRef',
  SetEngine: 'setEngine',
  SetFx: 'setFx',
  SetMasterGain: 'setMasterGain',
  SetParam: 'setParam',
  SetSupplementParam: 'setSupplementParam',
  SetMasterTune: 'setMasterTune',
  Panic: 'panic',
  SelectPart: 'selectPart',
  SetPart: 'setPart',
  SetPolyphonyCap: 'setPolyphonyCap',
  SelectPerformance: 'selectPerformance',
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
export interface SetEngineMsg {
  type: typeof MsgType.SetEngine;
  engine: number; // EngineType
}
export interface SetFxMsg {
  type: typeof MsgType.SetFx;
  cutoff: number;
  reso: number;
  gain: number;
}
export interface SetMasterGainMsg {
  type: typeof MsgType.SetMasterGain;
  gain: number;
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
export interface SetMasterTuneMsg {
  type: typeof MsgType.SetMasterTune;
  cents: number;
}
export interface PanicMsg {
  type: typeof MsgType.Panic;
}

export type ToWorkletMessage =
  | NoteOnMsg
  | NoteOffMsg
  | CcMsg
  | PitchBendMsg
  | AftertouchMsg
  | LoadVoiceMsg
  | LoadCartMsg
  | SetVoiceRefMsg
  | SetEngineMsg
  | SetFxMsg
  | SetMasterGainMsg
  | SetParamMsg
  | SetSupplementParamMsg
  | SetMasterTuneMsg
  | PanicMsg
  | SelectPartMsg
  | SetPartMsg
  | SetPolyphonyCapMsg
  | SelectPerformanceMsg;

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
/** Current master tune (from a loaded 8973S setup or the UI), sent after loads/tune changes. */
export interface MasterTuneMsg {
  type: 'masterTune';
  cents: number;
}
/** Periodic realtime status for UI meters (~30 Hz). */
export interface StatusMsg {
  type: 'status';
  amps: number[]; // per-op envelope output 0..1, sysex op order
  steps: number[]; // per-op envelope stage 0..4
  pitchStep: number;
  lfo: number; // 0..1
  selectedPart: number;
  partActivity: number[]; // sounding voice count per part
  totalActive: number;
}

/** Per-part rack configuration + selection, sent after any part change. */
export interface PartsMsg {
  type: 'parts';
  configs: PartConfig[];
  selectedPart: number;
}

export interface PerformancesMsg {
  type: 'performances';
  names: string[];
  index: number;
}

export type FromWorkletMessage =
  | ProgramStateMsg
  | LoadReportMsg
  | VoiceMsg
  | MasterTuneMsg
  | StatusMsg
  | PartsMsg
  | PerformancesMsg;
