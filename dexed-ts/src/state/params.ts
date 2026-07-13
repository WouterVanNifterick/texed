// State layer: parameter metadata and accessors for the unpacked 156-byte
// DX7 voice. Pure data — no audio, no React. Byte layout matches
// engine/cartridge.ts (ops stored in sysex order: index 0 = OP6 ... 5 = OP1).

export const CURVES = ['-LIN', '-EXP', '+EXP', '+LIN'];
export const OSC_MODES = ['RATIO', 'FIXED'];
export const LFO_WAVES = ['TRI', 'SW-', 'SW+', 'SQU', 'SIN', 'S/H'];

/** Byte offset of the 21-parameter block for UI operator `opNum` (1..6). */
export function opBase(opNum: number): number {
  return (6 - opNum) * 21;
}

// Relative offsets within an operator block.
export const OP = {
  egRate: (i: number) => i, // 0..3, range 0-99
  egLevel: (i: number) => 4 + i, // 0..3, range 0-99
  breakPoint: 8, // 0-99
  leftDepth: 9,
  rightDepth: 10,
  leftCurve: 11, // 0-3
  rightCurve: 12, // 0-3
  rateScaling: 13, // 0-7
  ampModSens: 14, // 0-3
  velocitySens: 15, // 0-7
  outputLevel: 16, // 0-99
  oscMode: 17, // 0-1
  freqCoarse: 18, // 0-31
  freqFine: 19, // 0-99
  detune: 20, // 0-14, displayed -7..+7
} as const;

// Global parameter offsets.
export const G = {
  pitchEgRate: (i: number) => 126 + i,
  pitchEgLevel: (i: number) => 130 + i,
  algorithm: 134, // 0-31, displayed 1-32
  feedback: 135, // 0-7
  oscKeySync: 136, // 0-1
  lfoSpeed: 137,
  lfoDelay: 138,
  lfoPmd: 139,
  lfoAmd: 140,
  lfoKeySync: 141, // 0-1
  lfoWave: 142, // 0-5
  pitchModSens: 143, // 0-7
  transpose: 144, // 0-48, 24 = C3
  name: 145, // 10 chars
  opEnable: 155, // bitmask, bit i = sysex op index i
} as const;

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
