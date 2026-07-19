// Byte layout of the unpacked 156-byte DX7 voice. Operators are stored in
// sysex order (index 0 = OP6 ... 5 = OP1); layout matches cartridge.ts
// unpacking. Single source of truth shared by the engine and the UI state
// layer (state/params.ts re-exports these).

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

/** Neutral stored values for center-relative dial display. */
export const PARAM_CENTER = {
  detune: 7,
  transpose: 24,
  pitchEgLevel: 50,
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
