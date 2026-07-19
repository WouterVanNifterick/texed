// State layer: accessors for the 35-byte DX7II AMEM voice supplement.
// Pure data - no audio, no React. Bit layout mirrors engine/amem.ts
// VoiceSupplement; setters return the single byte edit to send over the
// bridge as a SetSupplementParam message.

export interface ByteEdit {
  offset: number;
  value: number;
}

export const PEG_RANGES = ['8VA', '2VA', '1VA', '½VA'];
export const PORTA_MODES = ['RTN', 'FLW'];
export const PB_MODES = ['NRM', 'LOW', 'HIGH', 'K.ON'];

/** Per-op AMS 0–7 (op = sysex index, 0 = OP6 … 5 = OP1). */
export function getAms(a: Uint8Array, op: number): number {
  const byte = a[1 + (op >> 1)];
  return op % 2 === 0 ? byte & 0x07 : (byte >> 3) & 0x07;
}

export function setAms(a: Uint8Array, op: number, value: number): ByteEdit {
  const offset = 1 + (op >> 1);
  const v = value & 0x07;
  const byte = op % 2 === 0 ? (a[offset] & 0x38) | v : (a[offset] & 0x07) | (v << 3);
  return { offset, value: byte };
}

// Byte 0: per-op scaling mode, bit0 = OP6 … bit5 = OP1 (op = sysex index).
export const getScalingMode = (a: Uint8Array, op: number): boolean => ((a[0] >> op) & 1) !== 0;
export const setScalingMode = (a: Uint8Array, op: number, on: boolean): ByteEdit => ({
  offset: 0,
  value: on ? a[0] | (1 << op) : a[0] & ~(1 << op),
});

// Byte 4: bits 4–6 random pitch depth, bit3 pitch EG vel sens, bit2 LFO key trigger, bits 0–1 PEG range.
export const getRandomPitchDepth = (a: Uint8Array): number => (a[4] >> 4) & 0x07;
export const setRandomPitchDepth = (a: Uint8Array, depth: number): ByteEdit => ({
  offset: 4,
  value: (a[4] & 0x0f) | ((depth & 0x07) << 4),
});
export const getPitchEgVelSens = (a: Uint8Array): boolean => (a[4] & 0x08) !== 0;
export const setPitchEgVelSens = (a: Uint8Array, on: boolean): ByteEdit => ({
  offset: 4,
  value: on ? a[4] | 0x08 : a[4] & ~0x08,
});
export const getLfoKeyTrigger = (a: Uint8Array): boolean => (a[4] & 0x04) !== 0;
export const setLfoKeyTrigger = (a: Uint8Array, on: boolean): ByteEdit => ({
  offset: 4,
  value: on ? a[4] | 0x04 : a[4] & ~0x04,
});
export const getPitchEgRange = (a: Uint8Array): number => a[4] & 0x03;
export const setPitchEgRange = (a: Uint8Array, range: number): ByteEdit => ({
  offset: 4,
  value: (a[4] & ~0x03) | (range & 0x03),
});

// Byte 5: bit0 mono, bit1 unison, bits 2–5 pitch bend range 0–12.
export const getMono = (a: Uint8Array): boolean => (a[5] & 0x01) !== 0;
export const setMono = (a: Uint8Array, on: boolean): ByteEdit => ({
  offset: 5,
  value: on ? a[5] | 0x01 : a[5] & ~0x01,
});
export const getUnison = (a: Uint8Array): boolean => (a[5] & 0x02) !== 0;
export const setUnison = (a: Uint8Array, on: boolean): ByteEdit => ({
  offset: 5,
  value: on ? a[5] | 0x02 : a[5] & ~0x02,
});
export const getPitchBendRange = (a: Uint8Array): number => (a[5] >> 2) & 0x0f;
export const setPitchBendRange = (a: Uint8Array, range: number): ByteEdit => ({
  offset: 5,
  value: (a[5] & 0x03) | ((range & 0x0f) << 2),
});

// Byte 6: bits 4–5 pitch bend mode (NRM/LOW/HIGH/K.ON), bits 0–3 pitch bend step 0–12.
export const getPitchBendStep = (a: Uint8Array): number => a[6] & 0x0f;
export const setPitchBendStep = (a: Uint8Array, step: number): ByteEdit => ({
  offset: 6,
  value: (a[6] & 0x30) | (step & 0x0f),
});
export const getPitchBendMode = (a: Uint8Array): number => (a[6] >> 4) & 0x03;
export const setPitchBendMode = (a: Uint8Array, mode: number): ByteEdit => ({
  offset: 6,
  value: (a[6] & 0x0f) | ((mode & 0x03) << 4),
});

// Byte 7: bit0 portamento mode, bits 1–4 portamento step 0–12.
export const getPortaMode = (a: Uint8Array): number => a[7] & 0x01;
export const setPortaMode = (a: Uint8Array, mode: number): ByteEdit => ({
  offset: 7,
  value: (a[7] & ~0x01) | (mode & 0x01),
});
export const getPortaStep = (a: Uint8Array): number => (a[7] >> 1) & 0x0f;
export const setPortaStep = (a: Uint8Array, step: number): ByteEdit => ({
  offset: 7,
  value: (a[7] & 0x01) | ((step & 0x0f) << 1),
});

// Byte 8: portamento time 0–99.
export const getPortaTime = (a: Uint8Array): number => a[8] & 0x7f;
export const setPortaTime = (_a: Uint8Array, time: number): ByteEdit => ({
  offset: 8,
  value: time & 0x7f,
});

// ==== Controller modulation ranges (all plain 0–99 bytes) ====
// MW 9–11 (P/A/EG), FC1 12–15 (P/A/EG/VOL), BC 16–19 (P/A/EG/PITCH BIAS),
// AT 20–23 (P/A/EG/PITCH BIAS), FC2 26–29 (P/A/EG/VOL), MC 30–33 (P/A/EG/VOL).
export const CTRL_OFFSETS = {
  wheel: 9,
  foot: 12,
  breath: 16,
  at: 20,
  foot2: 26,
  midiCtrl: 30,
} as const;
export type CtrlName = keyof typeof CTRL_OFFSETS;

/** dest: 0 = pitch, 1 = amp, 2 = EG bias, 3 = vol (FC/MC) or pitch bias (BC/AT). */
export const getCtrlRange = (a: Uint8Array, ctrl: CtrlName, dest: number): number =>
  a[CTRL_OFFSETS[ctrl] + dest] & 0x7f;
export const setCtrlRange = (
  _a: Uint8Array,
  ctrl: CtrlName,
  dest: number,
  value: number,
): ByteEdit => ({
  offset: CTRL_OFFSETS[ctrl] + dest,
  value: value & 0x7f,
});

/** Neutral stored value for pitch bias (0–99 range). */
export const PITCH_BIAS_CENTER = 50;

/** Format a 0–99 pitch bias (50 = center) as −50..+49. */
export const formatPitchBias = (value: number): string => {
  const d = value - PITCH_BIAS_CENTER;
  return d > 0 ? `+${d}` : `${d}`;
};

// Byte 24: pitch EG rate scaling 0–7.
export const getPitchEgScaleRate = (a: Uint8Array): number => a[24] & 0x07;
export const setPitchEgScaleRate = (_a: Uint8Array, sens: number): ByteEdit => ({
  offset: 24,
  value: sens & 0x07,
});

// Byte 34: bits 0–2 unison detune, bit3 FC1-as-CS1.
export const getUnisonDetune = (a: Uint8Array): number => a[34] & 0x07;
export const setUnisonDetune = (a: Uint8Array, detune: number): ByteEdit => ({
  offset: 34,
  value: (a[34] & 0x08) | (detune & 0x07),
});
export const getFc1AsCs1 = (a: Uint8Array): boolean => (a[34] & 0x08) !== 0;
export const setFc1AsCs1 = (a: Uint8Array, on: boolean): ByteEdit => ({
  offset: 34,
  value: on ? a[34] | 0x08 : a[34] & ~0x08,
});
