// State layer: parameter metadata and accessors for the unpacked 156-byte
// DX7 voice. Pure data — no audio, no React. Byte offsets live in
// engine/voice-layout.ts (the single source of truth) and are re-exported here.

import { OP, G } from '../engine/voice-layout';

export { OP, G, opBase, PARAM_CENTER } from '../engine/voice-layout';

export const CURVES = ['-LIN', '-EXP', '+EXP', '+LIN'];
export const OSC_MODES = ['RATIO', 'FIXED'];
export const LFO_WAVES = ['TRI', 'SW-', 'SW+', 'SQU', 'SIN', 'S/H'];

export function getVoiceName(voice: Uint8Array): string {
  let s = '';
  for (let i = 0; i < 10; i++) {
    const c = voice[G.name + i] & 0x7f;
    s += String.fromCharCode(c < 32 ? 32 : c);
  }
  return s;
}

/** Returns a copy of `voice` with the 10-char name set (padded with spaces). */
export function withVoiceName(voice: Uint8Array, name: string): Uint8Array {
  const out = new Uint8Array(voice);
  for (let i = 0; i < 10; i++) {
    out[G.name + i] = i < name.length ? name.charCodeAt(i) & 0x7f : 32;
  }
  return out;
}

/** Human-readable oscillator frequency for an operator block. */
export function formatOpFreq(voice: Uint8Array, base: number): string {
  const mode = voice[base + OP.oscMode];
  const coarse = voice[base + OP.freqCoarse];
  const fine = voice[base + OP.freqFine];
  if (mode === 0) {
    const ratio = (coarse === 0 ? 0.5 : coarse) * (1 + fine / 100);
    return `x${ratio.toFixed(2)}`;
  }
  const hz = Math.pow(10, coarse & 3) * Math.pow(10, fine / 100);
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)}kHz` : `${hz.toFixed(2)}Hz`;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function formatTranspose(value: number): string {
  return `${NOTE_NAMES[value % 12]}${Math.floor(value / 12) + 1}`;
}

/** Signed semitone offset from middle C (stored 24 = 0). */
export function formatTransposeSemitones(value: number): string {
  const d = value - 24;
  return d > 0 ? `+${d}` : `${d}`;
}

export function formatDetune(value: number): string {
  const d = value - 7;
  return d > 0 ? `+${d}` : `${d}`;
}

/** Serialize the current voice as a DX7 single-voice SysEx dump (163 bytes). */
export function voiceToSysex(voice: Uint8Array): Uint8Array {
  const out = new Uint8Array(163);
  out.set([0xf0, 0x43, 0x00, 0x00, 0x01, 0x1b], 0);
  out.set(voice.subarray(0, 155), 6);
  let sum = 0;
  for (let i = 0; i < 155; i++) sum -= voice[i];
  out[161] = sum & 0x7f;
  out[162] = 0xf7;
  return out;
}
