// The unpacked 156-byte DX7 voice: byte layout, parameter metadata, and the
// accessors and formatters the UI reads it through. One module, so there is a
// single obvious place to look for "where does this parameter live".
//
// Operators are stored in sysex order (index 0 = OP6 ... 5 = OP1), matching
// cartridge.ts unpacking. Voice <-> SysEx conversion lives in sysex.ts.

/** Length of one unpacked, editable voice: 6 x 21 operator bytes + 30 global. */
export const VOICE_SIZE = 156;

/** Voices in one half-bank of voice memory (INT 1-32, INT 33-64, ...). */
export const VOICES_PER_BANK = 32;

/** Byte offset of the 21-parameter block for UI operator `opNum` (1..6). */
export function opBase(opNum: number): number {
  return (6 - opNum) * 21;
}

/** Relative offsets within an operator block. */
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

/** Global parameter offsets. */
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

/** Neutral stored values for center-relative dial display. */
export const PARAM_CENTER = {
  detune: 7,
  transpose: 24,
  pitchEgLevel: 50,
} as const;

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

/**
 * True for the placeholder names banks use to pad unused slots: blank, EMPTY,
 * and runs of a single filler character such as `----------` or `~~~~~~~~~~`.
 * Stepping through a library should pass straight over these.
 */
export function isFillerVoiceName(name: string): boolean {
  const s = name.trim();
  if (s === '' || s.toUpperCase() === 'EMPTY') return true;
  return /^[-~_.*=+ ]+$/.test(s);
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

/** Scientific pitch name for a MIDI note number, so 60 is C4 and 0 is C-1. */
export function noteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Transpose is stored as semitones above C1, so 12 reads as C2. */
export function formatTranspose(value: number): string {
  return noteName(value + 24);
}

/** Signed semitone offset from middle C (stored 24 = 0). */
export function formatTransposeSemitones(value: number): string {
  const d = value - PARAM_CENTER.transpose;
  return d > 0 ? `+${d}` : `${d}`;
}

export function formatDetune(value: number): string {
  const d = value - PARAM_CENTER.detune;
  return d > 0 ? `+${d}` : `${d}`;
}
