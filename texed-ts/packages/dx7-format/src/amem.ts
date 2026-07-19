// DX7II additional voice memory (AMEM): 35-byte supplement per voice, 1120-byte bulk.
//
// Authoritative packed layout (Yamaha DX7II MIDI data format, AMEM table):
//   0     |  0 | OP1| OP2| OP3| OP4| OP5| OP6|   scaling mode (0 norm / 1 fractional)
//   1     |  0 |   AMS OP5    |   AMS OP6    |
//   2     |  0 |   AMS OP3    |   AMS OP4    |
//   3     |  0 |   AMS OP1    |   AMS OP2    |
//   4     |  RNDP(0-7) |VPSW|LTRG|  PEGR(0-3)|   random pitch, PEG vel sw, LFO key trig, PEG range
//   5     |  0 | PBR(0-12)    |    |UNI |MONO|   pitch bend range, unison, poly/mono
//   6     |  0 | PBM(0-3)|     PBS(0-12)     |   pitch bend mode, pitch bend step
//   7     |  0 |  0 |   PQNT(0-12)      |PORM|   portamento step, portamento mode
//   8     portamento time 0-99
//   9-11  mod wheel:   pitch / amp / EG bias ranges (each 0-99)
//   12-15 foot ctrl 1: pitch / amp / EG bias / volume ranges
//   16-19 breath:      pitch / amp / EG bias / pitch bias (0-99, 50 = center)
//   20-23 aftertouch:  pitch / amp / EG bias / pitch bias (0-99, 50 = center)
//   24    pitch EG rate scaling depth 0-7
//   25    reserved
//   26-29 foot ctrl 2: pitch / amp / EG bias / volume ranges
//   30-33 MIDI in ctrl: pitch / amp / EG bias / volume ranges
//   34    |  0 |  0 |  0 |FCCS|   UDTN(0-7)  |   FC1-as-CS1, unison detune

export const AMEM_BULK_SIZE = 1120;
export const AMEM_SLOT_SIZE = 35;

const DEFAULT_AMEM_BYTES = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00,
];

export function createDefaultAmem(): Uint8Array {
  return new Uint8Array(DEFAULT_AMEM_BYTES);
}

/** Unpack a 1120-byte AMEM bulk into 32 supplement slots. */
export function unpackAmemBulk(packed: Uint8Array): Uint8Array[] {
  const slots: Uint8Array[] = [];
  for (let i = 0; i < 32; i++) {
    const off = i * AMEM_SLOT_SIZE;
    const slot = createDefaultAmem();
    if (off + AMEM_SLOT_SIZE <= packed.length) {
      slot.set(packed.subarray(off, off + AMEM_SLOT_SIZE));
    }
    slots.push(slot);
  }
  return slots;
}

/**
 * True when a 1120-byte format-0x06 payload is DX7II AMEM (32×35-byte slots),
 * not a TX802 performance dump (8×140-byte timbre blocks).
 */
export function looksLikeAmemBulk(data: Uint8Array): boolean {
  if (data.length !== AMEM_BULK_SIZE) return false;
  let markers = 0;
  for (let i = 0; i < 32; i++) {
    if (data[i * AMEM_SLOT_SIZE + 5] === 0x08) markers++;
  }
  return markers >= 16;
}

/** Extract payload bytes from a format-0x06 or 8973AM SysEx frame. */
export function amemPayloadFromFrame(raw: Uint8Array): Uint8Array | null {
  if (raw.length < 8) return null;
  const size = (raw[4] << 7) | raw[5];
  if (size < AMEM_BULK_SIZE || 6 + size > raw.length) return null;
  let data = raw.subarray(6, 6 + size);
  if (raw[3] === 0x7e && data.length > 10) data = data.subarray(10);
  return data.subarray(0, AMEM_BULK_SIZE);
}

// ==== ACED single dump ("LM  8973AE"): DX7II additional voice edit buffer ====
//
// The bulk AMEM slot (above) packs the supplement into 35 bytes; the single
// ACED edit-buffer dump carries the SAME parameters unpacked, one per byte, in
// the DX7II ACED parameter order (49 bytes). This is what the DX7II transmits
// (ACED then VCED) for the current voice, so a single-voice file pairs the two.

export const ACED_UNPACKED_SIZE = 49;
const ACED_ID = 'LM  8973AE';

/** Expand a 35-byte packed AMEM slot into the 49-byte unpacked ACED body. */
export function supplementToAced(amem: Uint8Array): Uint8Array {
  const a = amem;
  const u = new Uint8Array(ACED_UNPACKED_SIZE);
  // 0-5   scaling mode OP6..OP1 (packed a[0] bits 0..5, bit0 = OP6)
  for (let i = 0; i < 6; i++) u[i] = (a[0] >> i) & 1;
  // 6-11  AM sensitivity OP6..OP1 (packed a[1..3], two ops per byte)
  u[6] = a[1] & 0x07;
  u[7] = (a[1] >> 3) & 0x07;
  u[8] = a[2] & 0x07;
  u[9] = (a[2] >> 3) & 0x07;
  u[10] = a[3] & 0x07;
  u[11] = (a[3] >> 3) & 0x07;
  u[12] = a[4] & 0x03; // PEGR
  u[13] = (a[4] >> 2) & 0x01; // LTRG
  u[14] = (a[4] >> 3) & 0x01; // VPSW
  u[15] = a[5] & 0x03; // PMOD (bit0 mono, bit1 unison)
  u[16] = (a[5] >> 2) & 0x0f; // PBR
  u[17] = a[6] & 0x0f; // PBS
  u[18] = (a[6] >> 4) & 0x03; // PBM
  u[19] = (a[4] >> 4) & 0x07; // RNDP
  u[20] = a[7] & 0x01; // PORM
  u[21] = (a[7] >> 1) & 0x0f; // PQNT
  u[22] = a[8] & 0x7f; // portamento time
  for (let i = 0; i < 3; i++) u[23 + i] = a[9 + i] & 0x7f; // mod wheel
  for (let i = 0; i < 4; i++) u[26 + i] = a[12 + i] & 0x7f; // foot 1
  for (let i = 0; i < 4; i++) u[30 + i] = a[16 + i] & 0x7f; // breath
  for (let i = 0; i < 4; i++) u[34 + i] = a[20 + i] & 0x7f; // aftertouch
  u[38] = a[24] & 0x07; // pitch EG rate scaling
  for (let i = 0; i < 4; i++) u[39 + i] = a[26 + i] & 0x7f; // foot 2
  for (let i = 0; i < 4; i++) u[43 + i] = a[30 + i] & 0x7f; // MIDI in ctrl
  u[47] = a[34] & 0x07; // unison detune
  u[48] = (a[34] >> 3) & 0x01; // FC1-as-CS1
  return u;
}

/** Inverse of {@link supplementToAced}: pack a 49-byte ACED body into a slot. */
export function acedToSupplement(u: Uint8Array): Uint8Array {
  const a = createDefaultAmem();
  a[0] = 0;
  for (let i = 0; i < 6; i++) a[0] |= (u[i] & 1) << i;
  a[1] = (u[6] & 0x07) | ((u[7] & 0x07) << 3);
  a[2] = (u[8] & 0x07) | ((u[9] & 0x07) << 3);
  a[3] = (u[10] & 0x07) | ((u[11] & 0x07) << 3);
  a[4] = (u[12] & 0x03) | ((u[13] & 1) << 2) | ((u[14] & 1) << 3) | ((u[19] & 0x07) << 4);
  a[5] = (u[15] & 0x03) | ((u[16] & 0x0f) << 2);
  a[6] = (u[17] & 0x0f) | ((u[18] & 0x03) << 4);
  a[7] = (u[20] & 0x01) | ((u[21] & 0x0f) << 1);
  a[8] = u[22] & 0x7f;
  for (let i = 0; i < 3; i++) a[9 + i] = u[23 + i] & 0x7f;
  for (let i = 0; i < 4; i++) a[12 + i] = u[26 + i] & 0x7f;
  for (let i = 0; i < 4; i++) a[16 + i] = u[30 + i] & 0x7f;
  for (let i = 0; i < 4; i++) a[20 + i] = u[34 + i] & 0x7f;
  a[24] = u[38] & 0x07;
  for (let i = 0; i < 4; i++) a[26 + i] = u[39 + i] & 0x7f;
  for (let i = 0; i < 4; i++) a[30 + i] = u[43 + i] & 0x7f;
  a[34] = (u[47] & 0x07) | ((u[48] & 1) << 3);
  return a;
}

/**
 * Build a single ACED SysEx frame for a voice's 35-byte supplement:
 *   F0 43 00 7E 00 3B "LM  8973AE" <49 bytes> <checksum> F7
 */
export function acedToSysex(amem: Uint8Array): Uint8Array {
  const body = supplementToAced(amem);
  const size = ACED_ID.length + body.length; // 10 + 49 = 59
  const out = new Uint8Array(6 + size + 2);
  out.set([0xf0, 0x43, 0x00, 0x7e, (size >> 7) & 0x7f, size & 0x7f], 0);
  for (let i = 0; i < ACED_ID.length; i++) out[6 + i] = ACED_ID.charCodeAt(i);
  out.set(body, 6 + ACED_ID.length);
  let sum = 0;
  for (let i = 0; i < size; i++) sum -= out[6 + i];
  out[6 + size] = sum & 0x7f;
  out[6 + size + 1] = 0xf7;
  return out;
}

/** Pitch bend mode values (byte 6 bits 4-5). */
export const PitchBendMode = { Normal: 0, Low: 1, High: 2, KeyOn: 3 } as const;
export type PitchBendMode = (typeof PitchBendMode)[keyof typeof PitchBendMode];

/** DX7II modulation ranges for one physical controller (all 0-99). */
export interface CtrlRanges {
  pitch: number;
  amp: number;
  eg: number;
  /** FC1/FC2/MIDI-ctrl only: volume attenuation range. */
  vol: number;
  /** BC/AT only: pitch bias, stored 0-99 with 50 = no bias. */
  pitchBias: number;
}

function ctrlRanges(a: Uint8Array, off: number, hasVol: boolean, hasBias: boolean): CtrlRanges {
  return {
    pitch: a[off] & 0x7f,
    amp: a[off + 1] & 0x7f,
    eg: a[off + 2] & 0x7f,
    vol: hasVol ? a[off + 3] & 0x7f : 0,
    pitchBias: hasBias ? a[off + 3] & 0x7f : 50,
  };
}

/** Per-voice DX7II supplement parameters parsed from a 35-byte AMEM slot. */
export class VoiceSupplement {
  raw: Uint8Array;
  /** Per-op scaling mode (0 normal, 1 fractional), index 0 = OP6 … 5 = OP1. */
  scalingMode: number[];
  /** True when any operator uses fractional key scaling. */
  fksEnabled: boolean;
  /** AMS 0–7 per operator (index 0 = OP6 … 5 = OP1). */
  ams: number[];
  /** Random pitch fluctuation depth 0-7 (0 = off … 7 ≈ ±41 cents). */
  randomPitchDepth: number;
  pitchEgVelSens: boolean;
  /** LFO key trigger: false = single (one LFO per part), true = multi (retrigger per note). */
  lfoKeyTrigger: boolean;
  pitchEgRange: number;
  mono: boolean;
  unison: boolean;
  pitchBendRange: number;
  pitchBendStep: number;
  pitchBendMode: number;
  portamentoMode: number;
  /** Portamento step 0-12: 0 = smooth, n = glissando quantized to n semitones. */
  portamentoStep: number;
  portamentoTime: number;
  pitchEgScaleRate: number;
  unisonDetune: number;
  /** Foot controller 1 doubles as CS1 (front-panel slider); FC1 mod routings bypassed. */
  fc1AsCs1: boolean;

  wheel: CtrlRanges;
  foot: CtrlRanges;
  breath: CtrlRanges;
  at: CtrlRanges;
  foot2: CtrlRanges;
  midiCtrl: CtrlRanges;

  constructor(amem = createDefaultAmem()) {
    this.raw = amem;
    const a = amem;
    this.scalingMode = [
      a[0] & 1,
      (a[0] >> 1) & 1,
      (a[0] >> 2) & 1,
      (a[0] >> 3) & 1,
      (a[0] >> 4) & 1,
      (a[0] >> 5) & 1,
    ];
    this.fksEnabled = (a[0] & 0x3f) !== 0;
    this.ams = [
      a[1] & 0x07,
      (a[1] >> 3) & 0x07,
      a[2] & 0x07,
      (a[2] >> 3) & 0x07,
      a[3] & 0x07,
      (a[3] >> 3) & 0x07,
    ];
    this.randomPitchDepth = (a[4] >> 4) & 0x07;
    this.pitchEgVelSens = (a[4] & 0x08) !== 0;
    this.lfoKeyTrigger = (a[4] & 0x04) !== 0;
    this.pitchEgRange = a[4] & 0x03;
    this.mono = (a[5] & 0x01) !== 0;
    this.unison = (a[5] & 0x02) !== 0;
    this.pitchBendRange = (a[5] >> 2) & 0x0f;
    this.pitchBendStep = a[6] & 0x0f;
    this.pitchBendMode = (a[6] >> 4) & 0x03;
    this.portamentoMode = a[7] & 0x01;
    this.portamentoStep = (a[7] >> 1) & 0x0f;
    this.portamentoTime = a[8] & 0x7f;
    this.wheel = ctrlRanges(a, 9, false, false);
    this.foot = ctrlRanges(a, 12, true, false);
    this.breath = ctrlRanges(a, 16, false, true);
    this.at = ctrlRanges(a, 20, false, true);
    this.pitchEgScaleRate = a[24] & 0x07;
    this.foot2 = ctrlRanges(a, 26, true, false);
    this.midiCtrl = ctrlRanges(a, 30, true, false);
    this.unisonDetune = a[34] & 0x07;
    this.fc1AsCs1 = (a[34] & 0x08) !== 0;
  }

  /** Extended AMS sensitivity table index 0–7 for ampmodsenstab lookup. */
  amsIndex(op: number): number {
    return Math.min(7, Math.max(0, this.ams[op]));
  }
}

// DX7II AMS 0–7 is higher resolution over the same depth range as DX7 AMS 0–3
// (msfa ampmodsenstab). DXConvert/SY77 map DX7 0,1,2,3 → DX7II 0,2,5,7, so
// AMS 7 equals classic AMS 3 (1<<24). Intermediate steps are linear in the
// classic depth units 0,66,109,255 - never above 1<<24, or the msfa exp()
// curve overshoots and drives operator level negative (harsh digital noise).
export const extendedAmsTable = [
  0, // 0
  2_171_169, // 1  (~depth 33)
  4_342_338, // 2  (= DX7 AMS 1)
  5_263_440, // 3  (~depth 80)
  6_250_335, // 4  (~depth 95)
  7_171_437, // 5  (= DX7 AMS 2)
  11_974_327, // 6 (~depth 182)
  16_777_216, // 7 (= DX7 AMS 3)
];
