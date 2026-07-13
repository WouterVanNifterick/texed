// Message protocol between the main thread and the Dexed AudioWorklet.

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
  Panic: 'panic',
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
}
export interface PitchBendMsg {
  type: typeof MsgType.PitchBend;
  value: number; // 14-bit 0..16383
}
export interface AftertouchMsg {
  type: typeof MsgType.Aftertouch;
  value: number;
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
  | PanicMsg;

export interface ReadyMsg {
  type: 'ready';
}
export interface ProgramNamesMsg {
  type: 'programNames';
  names: string[];
}

export type FromWorkletMessage = ReadyMsg | ProgramNamesMsg;
