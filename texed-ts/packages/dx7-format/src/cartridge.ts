// DX7 cartridge / voice (un)packing, ported from Source/PluginData.cpp.
// Handles the 32-voice bulk SysEx dump (4104 bytes) and single-voice dumps.

import { readDx7AsciiName } from './voice';

export function sysexChecksum(data: Uint8Array, start: number, size: number): number {
  let sum = 0;
  for (let i = 0; i < size; i++) {
    sum -= data[start + i];
  }
  return sum & 0x7f;
}

/** The DX7 "INIT VOICE" (155 bytes) plus the op on/off byte. */
export function initVoice(): Uint8Array {
  // prettier-ignore
  const v = [
    99, 99, 99, 99, 99, 99, 99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 7,
    99, 99, 99, 99, 99, 99, 99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 7,
    99, 99, 99, 99, 99, 99, 99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 7,
    99, 99, 99, 99, 99, 99, 99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 7,
    99, 99, 99, 99, 99, 99, 99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 7,
    99, 99, 99, 99, 99, 99, 99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 99, 0, 1, 0, 7,
    99, 99, 99, 99, 50, 50, 50, 50, 0, 0, 1, 35, 0, 0, 0, 1, 0, 3, 24,
    73, 78, 73, 84, 32, 86, 79, 73, 67, 69,
  ];
  const out = new Uint8Array(156);
  out.set(v);
  out[155] = 0x3f;
  return out;
}

/**
 * Highest legal value for each byte of the 156-byte unpacked voice. Real-world
 * .syx files are full of out-of-range bytes (bit 7 set, stale editor state,
 * truncated dumps); unpacking masks bits but that still lets an EG rate reach
 * 127 where the DX7 tops out at 99. Clamping here keeps every downstream table
 * lookup in bounds.
 */
// prettier-ignore
const VOICE_MAXES = Uint8Array.from([
  // Six operators, 21 bytes each: EG rates/levels, scaling, curves, rate
  // scaling, AMS, KVS, output level, osc mode, coarse, fine, detune.
  ...Array.from({ length: 6 }, () => [
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 3, 3, 7, 3, 7, 99, 1, 31, 99, 14,
  ]).flat(),
  // Pitch EG rates and levels.
  99, 99, 99, 99, 99, 99, 99, 99,
  31, // algorithm
  7, // feedback
  1, // osc key sync
  99, 99, 99, 99, // LFO speed, delay, pitch mod depth, amp mod depth
  1, // LFO key sync
  5, // LFO waveform
  7, // pitch mod sensitivity
  48, // transpose
  127, 127, 127, 127, 127, 127, 127, 127, 127, 127, // name
  63, // operator on/off mask
]);

/** Clamp a 156-byte voice in place to the DX7's own parameter ranges. */
export function clampVoice(voice: Uint8Array): void {
  const n = Math.min(voice.length, VOICE_MAXES.length);
  for (let i = 0; i < n; i++) {
    if (voice[i] > VOICE_MAXES[i]) voice[i] = VOICE_MAXES[i];
  }
}

export class Cartridge {
  // 6-byte header + 32 * 128 packed voices + checksum + 0xF7 = 4104.
  voiceData = new Uint8Array(4104);

  /**
   * Parse raw SysEx bytes into a Cartridge. Accepts a 32-voice bulk dump
   * (>= 4104 bytes starting with 0xF0) or a raw 4096-byte packed block.
   * Returns null if the data cannot be interpreted.
   */
  static fromSyx(bytes: Uint8Array): Cartridge | null {
    if (bytes.length >= 4104 && bytes[0] === 0xf0) {
      const cart = new Cartridge();
      cart.voiceData.set(bytes.subarray(0, 4104));
      return cart;
    }
    if (bytes.length === 4096) {
      const cart = new Cartridge();
      // Fabricate a standard bulk header around the packed block.
      cart.voiceData.set([0xf0, 0x43, 0x00, 0x09, 0x20, 0x00], 0);
      cart.voiceData.set(bytes, 6);
      return cart;
    }
    return null;
  }

  /** Unpack packed voice `idx` (0..31) into a 156-byte editable voice. */
  unpackProgram(idx: number): Uint8Array {
    const out = new Uint8Array(156);
    const bulk = 6 + idx * 128;
    const d = this.voiceData;

    for (let op = 0; op < 6; op++) {
      const pp = bulk + op * 17;
      const up = op * 21;
      // eg rate/level, brk pt, depth, scaling (raw copy, matching Dexed's memcpy)
      for (let i = 0; i < 11; i++) {
        out[up + i] = d[pp + i];
      }
      const leftrightcurves = d[pp + 11] & 0xf;
      out[up + 11] = leftrightcurves & 3;
      out[up + 12] = (leftrightcurves >> 2) & 3;
      const detuneRs = d[pp + 12] & 0x7f;
      out[up + 13] = detuneRs & 7;
      const kvsAms = d[pp + 13] & 0x1f;
      out[up + 14] = kvsAms & 3;
      out[up + 15] = (kvsAms >> 2) & 7;
      out[up + 16] = d[pp + 14] & 0x7f;
      const fcoarseMode = d[pp + 15] & 0x3f;
      out[up + 17] = fcoarseMode & 1;
      out[up + 18] = (fcoarseMode >> 1) & 0x1f;
      out[up + 19] = d[pp + 16] & 0x7f;
      out[up + 20] = (detuneRs >> 3) & 0x7f;
    }

    for (let i = 0; i < 8; i++) {
      out[126 + i] = d[bulk + 102 + i] & 0x7f;
    }
    out[134] = d[bulk + 110] & 0x1f;
    const oksFb = d[bulk + 111] & 0xf;
    out[135] = oksFb & 7;
    out[136] = oksFb >> 3;
    out[137] = d[bulk + 112] & 0x7f;
    out[138] = d[bulk + 113] & 0x7f;
    out[139] = d[bulk + 114] & 0x7f;
    out[140] = d[bulk + 115] & 0x7f;
    const lpmsLfwLks = d[bulk + 116] & 0x7f;
    out[141] = lpmsLfwLks & 1;
    out[142] = (lpmsLfwLks >> 1) & 7;
    out[143] = lpmsLfwLks >> 4;
    out[144] = d[bulk + 117] & 0x7f;
    for (let n = 0; n < 10; n++) {
      out[145 + n] = d[bulk + 118 + n] & 0x7f;
    }
    out[155] = 0x3f;
    clampVoice(out);
    return out;
  }

  /** The 10-character program name for voice `idx`. */
  programName(idx: number): string {
    const bulk = 6 + idx * 128;
    return readDx7AsciiName(this.voiceData, bulk + 118, 10).trimEnd();
  }

  programNames(): string[] {
    return Array.from({ length: 32 }, (_, i) => this.programName(i));
  }
}
