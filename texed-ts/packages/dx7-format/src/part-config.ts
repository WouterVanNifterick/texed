// Multi-timbral part configuration: pure data shared by the engine, the
// control protocol, and performance (PCED) parsing. No DSP here - the
// SynthRack consumes these; a hardware or native host can too.

import { defaultVoiceRef, type VoiceRef } from './voice-library';

export const NUM_PARTS = 8;

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
  /** TX802 EG Forced Damp (per instrument). ON = stolen voice restarts its
   * envelope; OFF = new note continues the stolen note's envelope. */
  forcedDamp: boolean;
  /** TX802 Linked Tone Generator: when true, this part is a slave chained to the
   * nearest non-linked part above it, extending that instrument's polyphony. */
  link: boolean;
  voice: VoiceRef;
  /** Resolved display name when voice is set (from loaded banks). */
  voiceLabel?: string;
}

export function defaultPartConfig(enabled: boolean): PartConfig {
  return {
    enabled,
    rxChannel: 0,
    volume: 1,
    pan: 0,
    noteLow: 0,
    noteHigh: 127,
    noteShift: 0,
    detune: 0,
    forcedDamp: true,
    link: false,
    voice: defaultVoiceRef(),
  };
}

export interface ProgramOption {
  ref: VoiceRef;
  label: string;
}
