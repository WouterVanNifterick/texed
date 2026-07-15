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

  /** Apply per-voice controller settings from AMEM into a Part's Controllers. */
  applyToControllers(ctrls: Controllers): void {
    const setMod = (dst: typeof ctrls.wheel, src: CtrlRanges) => {
      dst.pitchRange = src.pitch;
      dst.ampRange = src.amp;
      dst.egRange = src.eg;
      dst.volRange = src.vol;
      dst.pitchBiasRange = src.pitchBias;
    };
    setMod(ctrls.wheel, this.wheel);
    setMod(ctrls.foot, this.foot);
    setMod(ctrls.breath, this.breath);
    setMod(ctrls.at, this.at);
    setMod(ctrls.foot2, this.foot2);
    setMod(ctrls.midiCs, this.midiCtrl);
    ctrls.fc1AsCs1 = this.fc1AsCs1;

    // Portamento from AMEM
    ctrls.portamentoStepCc = this.portamentoStep;
    ctrls.portamentoGlissCc = this.portamentoStep > 0;
    if (this.portamentoTime > 0) {
      ctrls.portamentoCc = this.portamentoTime;
      ctrls.portamentoEnableCc = true;
    }

    // Pitch bend range / step / mode from AMEM
    if (this.pitchBendRange > 0) {
      ctrls.values_[128] = 0x2000;
      ctrls.values_[129] = this.pitchBendRange;
      ctrls.values_[131] = this.pitchBendRange;
    }
    ctrls.values_[130] = Math.min(12, this.pitchBendStep);
    ctrls.refresh();
  }
}

// Extended AMS table: indices 0–3 match DX7; 4–7 extrapolated for DX7II.
export const extendedAmsTable = [
  0, 4_342_338, 7_171_437, 16_777_216,
  24_000_000, 32_000_000, 42_000_000, 56_000_000,
];
