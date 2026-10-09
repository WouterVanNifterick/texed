// TX802 / DX7II performance memory parsing into PartConfig.

import type { PartConfig } from './part-config';
import { NUM_PARTS } from './part-config';
import { bulkPayloadFromFrame, SysexKind, type SysexFrame } from './sysex';
import { decodeDx7iiVoiceRef, decodeTx802VoiceRef, defaultVoiceRef } from './voice-library';
import { readDx7AsciiName } from './voice';

export const TX802_PMEM_BLOCK = 84;
export const DX7II_PERF_BLOCK = 51;

const PERF_KINDS = new Set<SysexFrame['kind']>([
  SysexKind.Performance,
  SysexKind.Dx7iiPerformance,
  SysexKind.Dx7iiPerformanceEdit,
]);

export interface ParsedPerformance {
  name: string;
  parts: Partial<PartConfig>[];
}

function readAsciiName(bytes: Uint8Array, offset: number, len: number): string {
  return readDx7AsciiName(bytes, offset, len).trim();
}

function hexNibble(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x37;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x57;
  return -1;
}

/** Map TX802 receive channel (0–15, 16 = omni) to rack rxChannel (0 = omni, 1–16). */
function mapRxChannel(raw: number): number {
  const ch = raw & 0x1f;
  return ch >= 16 ? 0 : ch + 1;
}

/** Map TX802 output assign (1 = output I, 2 = output II, 3 = both) to stereo pan. */
function mapOutAssignPan(outAssign: number): number {
  if (outAssign === 1) return -1;
  if (outAssign === 2) return 1;
  return 0;
}

function disabledParts(): Partial<PartConfig>[] {
  return Array.from({ length: NUM_PARTS }, () => ({ enabled: false }));
}

/** Parse one 84-byte TX802 TPMEM block into per-part config + performance name. */
export function parseTx802PmemBlock(block: Uint8Array): ParsedPerformance {
  // TODO(TX802): parse the EG Forced Damp and Linked Tone Generator performance
  // bytes (offsets unknown); for now parts inherit the defaults
  // (forcedDamp: true, link: false) via selectPerformance.
  const parts: Partial<PartConfig>[] = [];
  for (let i = 0; i < NUM_PARTS; i++) {
    const outAssign = block[32 + i] & 0x03;
    const rawVoice = block[8 + i] & 0x7f;
    const voiceRef = decodeTx802VoiceRef(rawVoice);
    parts.push({
      enabled: outAssign !== 0 && rawVoice !== 0,
      rxChannel: mapRxChannel(block[i]),
      voice: voiceRef ?? defaultVoiceRef(),
      volume: (block[24 + i] & 0x7f) / 99,
      pan: mapOutAssignPan(outAssign),
      detune: ((block[32 + i] >> 3) & 0x0f) - 7,
      noteLow: block[40 + i] & 0x7f,
      noteHigh: block[48 + i] & 0x7f,
      noteShift: (block[56 + i] & 0x3f) - 24,
    });
  }
  return { name: readAsciiName(block, 64, 20), parts };
}

/** Parse one 51-byte DX7II performance (PCED/PMEM) block. */
export function parseDx7iiPerfBlock(block: Uint8Array): ParsedPerformance {
  const mode = block[0] & 0x03;
  const voiceA = block[1] & 0x7f;
  const voiceB = block[2] & 0x7f;
  const splitPoint = block[7] & 0x7f;
  const name = readAsciiName(block, 31, 20);
  const parts = disabledParts();

  const part = (voice: number, noteLow: number, noteHigh: number): Partial<PartConfig> => ({
    enabled: true,
    rxChannel: 0,
    voice: decodeDx7iiVoiceRef(voice),
    volume: 1,
    detune: 0,
    noteLow,
    noteHigh,
    noteShift: 0,
  });

  if (mode <= 1) parts[0] = part(voiceA, 0, 127);
  if (mode === 1) parts[1] = part(voiceB, 0, 127);
  else if (mode === 2) {
    parts[0] = part(voiceA, 0, splitPoint);
    parts[1] = part(voiceB, splitPoint, 127);
  }

  return { name, parts };
}

const TG_SYSEX_BLOCK = 140;

/** Part settings from one 140-byte timbre block of a format-0x06 dump. */
function parseTimbreBlock(blk: Uint8Array): Partial<PartConfig> {
  const outVol = blk[22] & 0x7f;
  const rawVoice = blk[9] & 0x7f;
  const nl = blk[44] & 0x7f;
  const nh = blk[45] & 0x7f;
  return {
    enabled: rawVoice !== 0,
    rxChannel: mapRxChannel(blk[0]),
    voice: decodeTx802VoiceRef(rawVoice) ?? defaultVoiceRef(),
    volume: outVol > 0 ? outVol / 99 : 1,
    pan: mapOutAssignPan(blk[5] & 0x03),
    detune: ((blk[32] >> 3) & 0x0f) - 7,
    noteLow: nh > nl ? nl : 0,
    noteHigh: nh > nl ? nh : 127,
    noteShift: (blk[56] & 0x3f) - 24,
  };
}

/** Parse a TX802 format-0x06 (1120-byte) single performance dump. */
export function parseTx802SysexPerf(data: Uint8Array): ParsedPerformance | null {
  if (data.length < TG_SYSEX_BLOCK) return null;
  const parts = disabledParts();
  let name = '';

  for (let t = 0; t < NUM_PARTS; t++) {
    const blk = data.subarray(t * TG_SYSEX_BLOCK, (t + 1) * TG_SYSEX_BLOCK);
    if (blk.length < TG_SYSEX_BLOCK) break;
    // A timbre with no output assigned and no volume is switched off.
    if ((blk[5] & 0x03) === 0 && (blk[22] & 0x7f) === 0) continue;

    name ||= readAsciiName(blk, 64, 20);
    parts[t] = parseTimbreBlock(blk);
  }

  if (!parts.some((p) => p.enabled)) {
    const blk = data.subarray(0, TG_SYSEX_BLOCK);
    parts[0] = { ...parseTimbreBlock(blk), volume: 1, noteLow: 0, noteHigh: 127 };
    name = readAsciiName(blk, 64, 20);
  }

  return { name, parts };
}

/** Decode one 84-byte TPMEM block from 168 ASCII-hex characters, or null on a non-hex byte. */
function decodeHexBlock(data: Uint8Array, pos: number): Uint8Array | null {
  const block = new Uint8Array(TX802_PMEM_BLOCK);
  for (let i = 0; i < TX802_PMEM_BLOCK; i++) {
    const hi = hexNibble(data[pos + 2 * i]);
    const lo = hexNibble(data[pos + 2 * i + 1]);
    if (hi < 0 || lo < 0) return null;
    block[i] = (hi << 4) | lo;
  }
  return block;
}

/** Decode TX802 8952PM ASCII-hex bank payload into 84-byte TPMEM blocks. */
function decodeTx802HexBank(data: Uint8Array): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  let pos = 0;
  while (pos + 2 * TX802_PMEM_BLOCK <= data.length) {
    const block = decodeHexBlock(data, pos);
    if (!block) break;
    blocks.push(block);
    pos += 2 * TX802_PMEM_BLOCK;
    if (
      pos + 13 <= data.length &&
      data[pos + 1] === 0x01 &&
      data[pos + 2] === 0x28 &&
      data[pos + 3] === 0x4c &&
      data[pos + 4] === 0x4d
    ) {
      pos += 13;
    } else if (pos + 12 <= data.length && data[pos] === 0x0a) {
      pos += 12;
    } else if (pos < data.length) {
      pos += 1;
    }
  }
  return blocks;
}

function isTx802PmemBank(frame: SysexFrame): boolean {
  return frame.formatId?.includes('8952PM') ?? false;
}

/** Extract performances from a SysEx frame, or null if unsupported. */
export function performancesFromFrame(frame: SysexFrame): ParsedPerformance[] | null {
  if (!PERF_KINDS.has(frame.kind)) return null;
  const data = bulkPayloadFromFrame(frame);
  if (!data || data.length === 0) return null;

  if (frame.kind === SysexKind.Performance) {
    const perf = parseTx802SysexPerf(data);
    return perf ? [perf] : null;
  }

  if (isTx802PmemBank(frame)) {
    const blocks = decodeTx802HexBank(data);
    return blocks.length > 0 ? blocks.map(parseTx802PmemBlock) : null;
  }

  if (frame.kind === SysexKind.Dx7iiPerformanceEdit) {
    if (data.length < DX7II_PERF_BLOCK) return null;
    return [parseDx7iiPerfBlock(data.subarray(0, DX7II_PERF_BLOCK))];
  }

  const count = Math.floor(data.length / DX7II_PERF_BLOCK);
  if (count === 0) return null;
  const out: ParsedPerformance[] = [];
  for (let i = 0; i < count; i++) {
    out.push(parseDx7iiPerfBlock(data.subarray(i * DX7II_PERF_BLOCK, (i + 1) * DX7II_PERF_BLOCK)));
  }
  return out;
}
