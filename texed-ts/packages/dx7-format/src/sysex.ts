// SysEx identification and (de)serialization for the Yamaha DX7 family.
//
// A single .syx file frequently concatenates several messages (e.g. a
// parameter-change, a performance bulk and a 32-voice bulk). This module
// splits a byte stream into individual F0..F7 frames and classifies each one.
//
// Verified header signatures (byte[0]=0xF0, byte[1]=0x43 Yamaha):
//   byte[2] = 0x1n            -> parameter change   (n = channel)
//   byte[2] = 0x0n, byte[3]:  -> bulk dump          (n = channel)
//       0x00  VCED   single voice           (155 data, 163 total)
//       0x02  PMEM   DX1/DX5 performance    (4096 data, 4104 total)
//       0x06  packed 32 supplement (DX7II AMEM, 1120 data) OR TX802 performance
//       0x09  VMEM   32-voice cartridge     (4096 data, 4104 total)
//       0x7E  named bulk: "LM  ####xx" (10 chars) then data
//           "LM  8973PM"  DX7II performance memory
//           "LM  8973PE"  DX7II performance edit buffer
//           "LM  8973AE"  DX7II additional voice edit (ACED)
//           "LM  8973AM"  DX7II additional voice memory (AMEM, 32)
//           "LM  FKSYE-M" DX7II fractional key scaling
//           "LM  FKSYC "  DX7II fractional key scaling (bank)
//           "LM  MCRYE"   DX7II microtuning (edit)
//           "LM  MCRYM"   DX7II microtuning (memory)

import { sysexChecksum, Cartridge, initVoice } from './cartridge';

export const SysexKind = {
  Voice: 'voice',
  Cartridge: 'cartridge',
  Aced: 'aced',
  AcedBank: 'acedBank',
  Amem: 'amem',
  Dx5Performance: 'dx5Performance',
  Performance: 'performance',
  Dx7iiPerformance: 'dx7iiPerformance',
  Dx7iiPerformanceEdit: 'dx7iiPerformanceEdit',
  FractionalScale: 'fractionalScale',
  Microtune: 'microtune',
  SystemSetup: 'systemSetup',
  ParamChange: 'paramChange',
  Unknown: 'unknown',
} as const;
export type SysexKind = (typeof SysexKind)[keyof typeof SysexKind];

export interface SysexFrame {
  kind: SysexKind;
  /** The complete frame including the leading 0xF0 and trailing 0xF7. */
  raw: Uint8Array;
  /** Low nibble of the sub-status byte (MIDI channel for the dump). */
  channel: number;
  /** Bulk-dump format byte (byte[3]) when applicable. */
  format?: number;
  /** 10-char format id for name-based (0x7E) dumps, e.g. "LM  8973PM". */
  formatId?: string;
  /** Whether the trailing checksum matched the payload. */
  checksumOk?: boolean;
}

/** Split a raw byte stream into individual F0..F7 SysEx frames. */
export function splitSysex(bytes: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    if (bytes[i] !== 0xf0) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && bytes[j] !== 0xf7) j++;
    if (j < n) {
      frames.push(bytes.subarray(i, j + 1));
      i = j + 1;
    } else {
      // Unterminated frame: take the remainder.
      frames.push(bytes.subarray(i, n));
      break;
    }
  }
  return frames;
}

function readFormatId(frame: Uint8Array): string {
  let s = '';
  for (let k = 6; k < 16 && k < frame.length; k++) {
    s += String.fromCharCode(frame[k] & 0x7f);
  }
  return s;
}

function verifyChecksum(frame: Uint8Array, dataStart: number, dataLen: number): boolean {
  const cksumIdx = dataStart + dataLen;
  if (cksumIdx >= frame.length) return false;
  return sysexChecksum(frame, dataStart, dataLen) === (frame[cksumIdx] & 0x7f);
}

const NAMED_KINDS: Record<string, SysexKind> = {
  '8952PM': SysexKind.Dx7iiPerformance,
  '8952PE': SysexKind.Dx7iiPerformanceEdit,
  '8973PM': SysexKind.Dx7iiPerformance,
  '8973PE': SysexKind.Dx7iiPerformanceEdit,
  '8973AE': SysexKind.Aced,
  '8973AM': SysexKind.AcedBank,
  '8973S': SysexKind.SystemSetup,
  FKSYEM: SysexKind.FractionalScale,
  FKSYC: SysexKind.FractionalScale,
  MCRYE: SysexKind.Microtune,
  MCRYM: SysexKind.Microtune,
};

/** Compact a 10-char LM format id for NAMED_KINDS lookup (handles MCRYMx slot byte). */
function compactFormatKey(formatId: string): string {
  const trimmed = formatId.replace(/^LM/, '').replace(/[\s-]/g, '');
  for (const key of Object.keys(NAMED_KINDS)) {
    if (trimmed.startsWith(key)) return key;
  }
  return trimmed;
}

import { looksLikeAmemBulk } from './amem';

const TX802_PERF_BLOCK = 140;

/** Bulk payload bytes from a classified frame (handles undersized 8952PM headers). */
export function bulkPayloadFromFrame(frame: SysexFrame): Uint8Array | null {
  const raw = frame.raw;
  if (raw.length < 8) return null;
  let size = (raw[4] << 7) | raw[5];
  const actualSize = raw.length - 8;
  if (frame.format === 0x7e && size < actualSize) size = actualSize;
  if (size <= 0 || 6 + size > raw.length) return null;
  let data = raw.subarray(6, 6 + size);
  if (frame.format === 0x7e && data.length > 10) data = data.subarray(10);
  return data;
}

/** True when a format-0x06 1120-byte payload looks like a TX802 performance dump. */
function isTx802PerformancePayload(data: Uint8Array): boolean {
  if (data.length !== TX802_PERF_BLOCK * 8) return false;
  if (looksLikeAmemBulk(data)) return false;
  let enabledParts = 0;
  for (let t = 0; t < 8; t++) {
    const blk = data.subarray(t * TX802_PERF_BLOCK, (t + 1) * TX802_PERF_BLOCK);
    const outAssign = blk[5] & 0x03;
    const outVol = blk[22] & 0x7f;
    if (outAssign !== 0 || outVol > 0) enabledParts++;
  }
  return enabledParts >= 1;
}

/** Classify a single F0..F7 frame. */
export function identifyFrame(frame: Uint8Array): SysexFrame {
  const base: SysexFrame = { kind: SysexKind.Unknown, raw: frame, channel: 0 };
  if (frame.length < 4 || frame[0] !== 0xf0 || frame[1] !== 0x43) return base;

  const sub = frame[2];
  const channel = sub & 0x0f;
  base.channel = channel;

  // Parameter change: F0 43 1n ...
  if ((sub & 0xf0) === 0x10) {
    return { ...base, kind: SysexKind.ParamChange };
  }

  // Bulk dump: F0 43 0n <format> ...
  if ((sub & 0xf0) !== 0x00) return base;

  const format = frame[3];
  base.format = format;

  switch (format) {
    case 0x00:
      return { ...base, kind: SysexKind.Voice, checksumOk: verifyChecksum(frame, 6, 155) };
    case 0x09:
      return { ...base, kind: SysexKind.Cartridge, checksumOk: verifyChecksum(frame, 6, 4096) };
    case 0x02: {
      const size = (frame[4] << 7) | frame[5];
      return { ...base, kind: SysexKind.Dx5Performance, checksumOk: verifyChecksum(frame, 6, size) };
    }
    case 0x06: {
      const size = (frame[4] << 7) | frame[5];
      const data = frame.subarray(6, 6 + size);
      const kind = size === 1120 && !isTx802PerformancePayload(data)
        ? SysexKind.Amem
        : SysexKind.Performance;
      return { ...base, kind, checksumOk: verifyChecksum(frame, 6, size) };
    }
    case 0x7e: {
      const size = (frame[4] << 7) | frame[5];
      const formatId = readFormatId(frame);
      // Compact the id (drop the "LM  " prefix and spaces/dashes) for lookup.
      const key = compactFormatKey(formatId);
      const kind = NAMED_KINDS[key] ?? SysexKind.Unknown;
      // Named dumps carry the id in the first 10 payload bytes; the checksum
      // covers size bytes starting at byte[6] (the id is part of the payload).
      return { ...base, kind, formatId, checksumOk: verifyChecksum(frame, 6, size) };
    }
    default:
      return base;
  }
}

/** Split and classify every SysEx frame found in a byte stream. */
export function identifySysex(bytes: Uint8Array): SysexFrame[] {
  return splitSysex(bytes).map(identifyFrame);
}

// ==== VCED (single voice) <-> 156-byte editable voice ====

/** True when `bytes` is raw VCED parameter data (no F0..F7 wrapper). */
export function isRawVcedBuffer(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes[0] === 0xf0) return false;
  return bytes.length === 155 || bytes.length === 156 || (bytes.length > 155 && bytes.length % 155 === 0);
}

/**
 * Convert raw VCED bytes (155 or 156) into the 156-byte editable voice.
 * 155-byte dumps omit the operator on/off mask; it defaults to 0x3F (all ops on).
 */
export function voiceFromRawVced(data: Uint8Array): Uint8Array | null {
  if (data.length === 155) {
    const out = new Uint8Array(156);
    out.set(data);
    out[155] = 0x3f;
    return out;
  }
  if (data.length === 156) {
    return data.slice();
  }
  return null;
}

/**
 * Convert a VCED single-voice frame (F0 43 0n 00 01 1B <155 bytes> cksum F7)
 * into the 156-byte editable voice used by the engine. The 156th byte is the
 * operator on/off mask, which is not part of a VCED, so it defaults to 0x3F
 * (all six operators enabled), matching Dexed.
 */
export function voiceFromVced(frame: Uint8Array): Uint8Array | null {
  if (frame.length < 6 + 155) return null;
  return voiceFromRawVced(frame.subarray(6, 6 + 155));
}

/** Serialize a 156-byte editable voice as a 163-byte VCED single-voice dump. */
/** DX7 VCED single-parameter change: live edit of one byte of the 156-byte voice. */
export function voiceParamChangeSysex(offset: number, value: number, device = 0): Uint8Array {
  return Uint8Array.of(0xf0, 0x43, 0x10 | (device & 0x0f), (offset >> 7) & 0x7f, offset & 0x7f, value & 0x7f, 0xf7);
}

export function vcedFromVoice(voice: Uint8Array, channel = 0): Uint8Array {
  const out = new Uint8Array(163);
  out.set([0xf0, 0x43, 0x00 | (channel & 0x0f), 0x00, 0x01, 0x1b], 0);
  out.set(voice.subarray(0, 155), 6);
  out[161] = sysexChecksum(voice, 0, 155);
  out[162] = 0xf7;
  return out;
}

// ==== VMEM (32-voice cartridge) ====

/** Parse a VMEM cartridge frame into a Cartridge, or null. */
export function cartridgeFromSyx(frame: Uint8Array): Cartridge | null {
  return Cartridge.fromSyx(frame);
}

/**
 * Pack up to 32 editable 156-byte voices into a 4104-byte VMEM bulk dump.
 * Voices beyond the supplied list are filled with the init voice.
 */
export function cartridgeFromVoices(voices: Uint8Array[], channel = 0): Cartridge {
  const cart = new Cartridge();
  const d = cart.voiceData;
  d.set([0xf0, 0x43, 0x00 | (channel & 0x0f), 0x09, 0x20, 0x00], 0);
  for (let idx = 0; idx < 32; idx++) {
    const v = voices[idx] ?? initVoice();
    packVoice(v, d, 6 + idx * 128);
  }
  d[6 + 4096] = sysexChecksum(d, 6, 4096);
  d[6 + 4096 + 1] = 0xf7;
  return cart;
}

/** Pack one 156-byte editable voice into a 128-byte VMEM slot (inverse of Cartridge.unpackProgram). */
export function packVoice(voice: Uint8Array, out: Uint8Array, at: number): void {
  for (let op = 0; op < 6; op++) {
    const up = op * 21;
    const pp = at + op * 17;
    for (let i = 0; i < 11; i++) out[pp + i] = voice[up + i];
    out[pp + 11] = (voice[up + 11] & 3) | ((voice[up + 12] & 3) << 2);
    out[pp + 12] = (voice[up + 13] & 7) | ((voice[up + 20] & 0x0f) << 3);
    out[pp + 13] = (voice[up + 14] & 3) | ((voice[up + 15] & 7) << 2);
    out[pp + 14] = voice[up + 16] & 0x7f;
    out[pp + 15] = (voice[up + 17] & 1) | ((voice[up + 18] & 0x1f) << 1);
    out[pp + 16] = voice[up + 19] & 0x7f;
  }
  for (let i = 0; i < 8; i++) out[at + 102 + i] = voice[126 + i] & 0x7f;
  out[at + 110] = voice[134] & 0x1f;
  out[at + 111] = (voice[135] & 7) | ((voice[136] & 1) << 3);
  out[at + 112] = voice[137] & 0x7f;
  out[at + 113] = voice[138] & 0x7f;
  out[at + 114] = voice[139] & 0x7f;
  out[at + 115] = voice[140] & 0x7f;
  out[at + 116] = (voice[141] & 1) | ((voice[142] & 7) << 1) | ((voice[143] & 7) << 4);
  out[at + 117] = voice[144] & 0x7f;
  for (let n = 0; n < 10; n++) out[at + 118 + n] = voice[145 + n] & 0x7f;
}
