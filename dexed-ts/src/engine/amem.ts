// DX7II additional voice memory (AMEM): 35-byte supplement per voice, 1120-byte bulk.

import type { Controllers } from './controllers';

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

/** Extract payload bytes from a format-0x06 or 8973AM SysEx frame. */
export function amemPayloadFromFrame(raw: Uint8Array): Uint8Array | null {
  if (raw.length < 8) return null;
  const size = (raw[4] << 7) | raw[5];
  if (size < AMEM_BULK_SIZE || 6 + size > raw.length) return null;
  let data = raw.subarray(6, 6 + size);
  if (raw[3] === 0x7e && data.length > 10) data = data.subarray(10);
  return data.subarray(0, AMEM_BULK_SIZE);
}

/** Per-voice DX7II supplement parameters parsed from a 35-byte AMEM slot. */
export class VoiceSupplement {
  raw: Uint8Array;
  fksEnabled: boolean;
  /** AMS 0–7 per operator (index 0 = OP6 … 5 = OP1). */
  ams: number[];
  randomPitch: boolean;
  pitchEgVelSens: boolean;
  multiLfo: boolean;
  pitchEgRange: number;
  mono: boolean;
  unison: boolean;
  unisonDetune: number;
  pitchBendRange: number;
  pitchBendStep: number;
  portamentoMode: number;
  portamentoGliss: boolean;
  portamentoTime: number;
  pitchEgScaleRate: number;

  constructor(amem = createDefaultAmem()) {
    this.raw = amem;
    const a = amem;
    this.fksEnabled = (a[0] & 0x7f) !== 0;
    this.ams = [
      a[1] & 0x07,
      (a[1] >> 3) & 0x07,
      a[2] & 0x07,
      (a[2] >> 3) & 0x07,
      a[3] & 0x07,
      (a[3] >> 3) & 0x07,
    ];
    this.randomPitch = (a[4] & 0x10) !== 0;
    this.pitchEgVelSens = (a[4] & 0x08) !== 0;
    this.multiLfo = (a[4] & 0x04) !== 0;
    this.pitchEgRange = a[4] & 0x03;
    this.mono = (a[5] & 0x01) !== 0;
    this.unison = (a[5] & 0x02) !== 0;
    this.pitchBendRange = (a[5] >> 2) & 0x1f;
    this.pitchBendStep = a[6] & 0x7f;
    this.portamentoMode = a[7] & 0x01;
    this.portamentoGliss = (a[7] & 0x02) !== 0;
    this.portamentoTime = a[8] & 0x7f;
    this.pitchEgScaleRate = a[24] & 0x7f;
    this.unisonDetune = a[34] & 0x07;
  }

  /** Extended AMS sensitivity table index 0–7 for ampmodsenstab lookup. */
  amsIndex(op: number): number {
    return Math.min(7, Math.max(0, this.ams[op]));
  }

  /** Apply per-voice controller defaults from AMEM into a Part's Controllers. */
  applyToControllers(ctrls: Controllers): void {
    const a = this.raw;
    // Mod wheel (bytes 9–11)
    if (a[9] || a[10] || a[11]) {
      ctrls.wheel.range = a[9] & 0x7f;
      ctrls.wheel.pitch = (a[10] & 0x01) !== 0;
      ctrls.wheel.amp = (a[10] & 0x02) !== 0;
      ctrls.wheel.eg = (a[10] & 0x04) !== 0;
    }
    // Foot controller (12–14)
    if (a[12] || a[13] || a[14]) {
      ctrls.foot.range = a[12] & 0x7f;
      ctrls.foot.pitch = (a[13] & 0x01) !== 0;
      ctrls.foot.amp = (a[13] & 0x02) !== 0;
      ctrls.foot.eg = (a[13] & 0x04) !== 0;
    }
    // Breath (16–18)
    if (a[16] || a[17] || a[18]) {
      ctrls.breath.range = a[16] & 0x7f;
      ctrls.breath.pitch = (a[17] & 0x01) !== 0;
      ctrls.breath.amp = (a[17] & 0x02) !== 0;
      ctrls.breath.eg = (a[17] & 0x04) !== 0;
    }
    // Aftertouch (20–22)
    if (a[20] || a[21] || a[22]) {
      ctrls.at.range = a[20] & 0x7f;
      ctrls.at.pitch = (a[21] & 0x01) !== 0;
      ctrls.at.amp = (a[21] & 0x02) !== 0;
      ctrls.at.eg = (a[21] & 0x04) !== 0;
    }
    // Portamento from AMEM
    if (this.portamentoTime > 0) {
      ctrls.portamentoCc = this.portamentoTime;
      ctrls.portamentoEnableCc = true;
      ctrls.portamentoGlissCc = this.portamentoGliss;
    }
    // Pitch bend range from AMEM (byte 5 upper bits)
    if (this.pitchBendRange > 0) {
      ctrls.values_[128] = 0x2000;
      ctrls.values_[129] = this.pitchBendRange;
      ctrls.values_[131] = this.pitchBendRange;
    }
    // Pitch bend step (0 = continuous, 1–12 = quantized to N-semitone steps)
    ctrls.values_[130] = Math.min(12, this.pitchBendStep);
    ctrls.refresh();
  }
}

// Extended AMS table: indices 0–3 match DX7; 4–7 extrapolated for DX7II.
export const extendedAmsTable = [
  0, 4_342_338, 7_171_437, 16_777_216,
  24_000_000, 32_000_000, 42_000_000, 56_000_000,
];
