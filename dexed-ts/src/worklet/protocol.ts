// Message protocol between the main thread and the Dexed AudioWorklet.

import type { PartConfig } from '../engine/synth-rack';

export const MsgType = {
  NoteOn: 'noteOn',
  NoteOff: 'noteOff',
  Cc: 'cc',
  PitchBend: 'pitchBend',
  Aftertouch: 'aftertouch',
  LoadVoice: 'loadVoice',
  LoadCart: 'loadCart',
  SetProgram: 'setProgram',
  SetEngine: 'setEngine',
  SetFx: 'setFx',
  SetMasterGain: 'setMasterGain',
  SetParam: 'setParam',
  Panic: 'panic',
  // Multitimbral (SynthRack)
  SelectPart: 'selectPart',
  SetPart: 'setPart',
  SetPolyphonyCap: 'setPolyphonyCap',
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
export interface SetProgramMsg {
  type: typeof MsgType.SetProgram;
  index: number;
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
  | SetProgramMsg
  | SetEngineMsg
  | SetFxMsg
  | SetMasterGainMsg
  | SetParamMsg
  | PanicMsg
  | SelectPartMsg
  | SetPartMsg
  | SetPolyphonyCapMsg;

export interface ReadyMsg {
  type: 'ready';
}
export interface ProgramNamesMsg {
  type: 'programNames';
  names: string[];
}
/** Full current voice, sent after program/cartridge/voice loads. */
export interface VoiceMsg {
  type: 'voice';
  data: Uint8Array; // 156 bytes
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

export type FromWorkletMessage = ReadyMsg | ProgramNamesMsg | VoiceMsg | StatusMsg | PartsMsg;
