// State layer: accessors for the 35-byte DX7II AMEM voice supplement.
// Pure data — no audio, no React. Bit layout mirrors engine/amem.ts
// VoiceSupplement; setters return the single byte edit to send over the
// bridge as a SetSupplementParam message.

export interface ByteEdit {
  offset: number;
  value: number;
}

export const PEG_RANGES = ['8VA', '2VA', '1VA', '½VA'];
export const PORTA_MODES = ['RTN', 'FLW'];

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

// Byte 4: bit4 random pitch, bit3 pitch EG vel sens, bit2 multi LFO, bits 0–1 PEG range.
export const getRandomPitch = (a: Uint8Array): boolean => (a[4] & 0x10) !== 0;
export const setRandomPitch = (a: Uint8Array, on: boolean): ByteEdit => ({
  offset: 4,
  value: on ? a[4] | 0x10 : a[4] & ~0x10,
});
export const getPitchEgVelSens = (a: Uint8Array): boolean => (a[4] & 0x08) !== 0;
export const setPitchEgVelSens = (a: Uint8Array, on: boolean): ByteEdit => ({
  offset: 4,
  value: on ? a[4] | 0x08 : a[4] & ~0x08,
});
export const getPitchEgRange = (a: Uint8Array): number => a[4] & 0x03;
export const setPitchEgRange = (a: Uint8Array, range: number): ByteEdit => ({
  offset: 4,
  value: (a[4] & ~0x03) | (range & 0x03),
});

// Byte 5: bit0 mono, bit1 unison, bits 2–6 pitch bend range.
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
export const getPitchBendRange = (a: Uint8Array): number => (a[5] >> 2) & 0x1f;
export const setPitchBendRange = (a: Uint8Array, range: number): ByteEdit => ({
  offset: 5,
  value: (a[5] & 0x03) | ((range & 0x1f) << 2),
});

// Byte 6: pitch bend step 0–12.
export const getPitchBendStep = (a: Uint8Array): number => a[6] & 0x7f;
export const setPitchBendStep = (_a: Uint8Array, step: number): ByteEdit => ({
  offset: 6,
  value: step & 0x7f,
});

// Byte 7: bit0 portamento mode, bit1 glissando.
export const getPortaMode = (a: Uint8Array): number => a[7] & 0x01;
export const setPortaMode = (a: Uint8Array, mode: number): ByteEdit => ({
  offset: 7,
  value: (a[7] & ~0x01) | (mode & 0x01),
});
export const getPortaGliss = (a: Uint8Array): boolean => (a[7] & 0x02) !== 0;
export const setPortaGliss = (a: Uint8Array, on: boolean): ByteEdit => ({
  offset: 7,
  value: on ? a[7] | 0x02 : a[7] & ~0x02,
});

// Byte 8: portamento time 0–99.
export const getPortaTime = (a: Uint8Array): number => a[8] & 0x7f;
export const setPortaTime = (_a: Uint8Array, time: number): ByteEdit => ({
  offset: 8,
  value: time & 0x7f,
});

// Byte 24: pitch EG rate scaling 0–7.
export const getPitchEgScaleRate = (a: Uint8Array): number => a[24] & 0x07;
export const setPitchEgScaleRate = (_a: Uint8Array, sens: number): ByteEdit => ({
  offset: 24,
  value: sens & 0x07,
});

// Byte 34: unison detune 0–7.
export const getUnisonDetune = (a: Uint8Array): number => a[34] & 0x07;
export const setUnisonDetune = (_a: Uint8Array, detune: number): ByteEdit => ({
  offset: 34,
  value: detune & 0x07,
});
