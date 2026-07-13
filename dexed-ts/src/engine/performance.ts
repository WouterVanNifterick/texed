// TX802 / DX7II performance memory parsing into PartConfig.

import type { PartConfig } from './synth-rack';
import { NUM_PARTS } from './synth-rack';
import { SysexKind, type SysexFrame } from './sysex';
import { decodeDx7iiVoiceRef, defaultVoiceRef, type VoiceRef } from './voice-library';

export const TX802_PMEM_BLOCK = 84;
export const DX7II_PERF_BLOCK = 51;
/** @deprecated Use TX802_PMEM_BLOCK */
export const PMEM_BLOCK = TX802_PMEM_BLOCK;

const TX802_PERF_KINDS = new Set<SysexFrame['kind']>([
  SysexKind.Performance,
  SysexKind.Dx7iiPerformance,
  SysexKind.Dx7iiPerformanceEdit,
]);

export interface ParsedPerformance {
  name: string;
  parts: Partial<PartConfig>[];
}

function readAsciiName(bytes: Uint8Array, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = bytes[offset + i] & 0x7f;
    s += String.fromCharCode(c < 32 ? 32 : c);
  }
  return s.trim();
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

/** Map TX802 voice number to a VoiceRef (cartridge voices 64–95 → internalA offset). */
function mapTx802VoiceRef(vnum: number): VoiceRef {
  const v = vnum & 0xff;
  if (v >= 64 && v < 128) {
    return { bank: 'internalA', program: Math.min(31, v - 64) };
  }
  return { bank: 'internalA', program: Math.min(31, v & 0x1f) };
}

function disabledParts(): Partial<PartConfig>[] {
  return Array.from({ length: NUM_PARTS }, () => ({ enabled: false }));
}

/** Parse one 84-byte TX802 TPMEM block into per-part config + performance name. */
export function parseTx802PmemBlock(block: Uint8Array): ParsedPerformance {
  const parts: Partial<PartConfig>[] = [];
  for (let i = 0; i < NUM_PARTS; i++) {
    const outAssign = block[32 + i] & 0x03;
    parts.push({
      enabled: outAssign !== 0,
      rxChannel: mapRxChannel(block[i]),
      voice: mapTx802VoiceRef(block[8 + i]),
      volume: (block[24 + i] & 0x7f) / 99,
      detune: ((block[32 + i] >> 3) & 0x0f) - 7,
      noteLow: block[40 + i] & 0x7f,
      noteHigh: block[48 + i] & 0x7f,
      noteShift: (block[56 + i] & 0x3f) - 24,
    });
  }
  return { name: readAsciiName(block, 64, 20), parts };
}

/** @deprecated Use parseTx802PmemBlock */
export const parsePmemBlock = parseTx802PmemBlock;

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

  if (mode === 0) {
    parts[0] = part(voiceA, 0, 127);
  } else if (mode === 1) {
    parts[0] = part(voiceA, 0, 127);
    parts[1] = part(voiceB, 0, 127);
  } else if (mode === 2) {
    parts[0] = part(voiceA, 0, splitPoint);
    parts[1] = part(voiceB, splitPoint, 127);
  }

  return { name, parts };
}

const TG_SYSEX_BLOCK = 140;

/** Parse a TX802 format-0x06 (1120-byte) single performance dump. */
export function parseTx802SysexPerf(data: Uint8Array): ParsedPerformance | null {
  if (data.length < TG_SYSEX_BLOCK) return null;
  const parts = disabledParts();
  let name = '';

  for (let t = 0; t < NUM_PARTS; t++) {
    const blk = data.subarray(t * TG_SYSEX_BLOCK, (t + 1) * TG_SYSEX_BLOCK);
    if (blk.length < TG_SYSEX_BLOCK) break;

    const outAssign = blk[5] & 0x03;
    const outVol = blk[22] & 0x7f;
    const enabled = outAssign !== 0 || outVol > 0;
    if (!enabled) continue;

    const nl = blk[44] & 0x7f;
    const nh = blk[45] & 0x7f;
    const noteLow = nh > nl ? nl : 0;
    const noteHigh = nh > nl ? nh : 127;

    parts[t] = {
      enabled: true,
      rxChannel: 0,
      voice: mapTx802VoiceRef(blk[9]),
      volume: outVol > 0 ? outVol / 99 : 1,
      detune: 0,
      noteLow,
      noteHigh,
      noteShift: 0,
    };
  }

  if (!parts.some((p) => p.enabled)) {
    const blk = data.subarray(0, TG_SYSEX_BLOCK);
    parts[0] = {
      enabled: true,
      rxChannel: 0,
      voice: mapTx802VoiceRef(blk[9]),
      volume: 1,
      detune: 0,
      noteLow: 0,
      noteHigh: 127,
      noteShift: 0,
    };
  }

  return { name, parts };
}

/** Decode TX802 8952PM ASCII-hex bank payload into 84-byte TPMEM blocks. */
function decodeTx802HexBank(data: Uint8Array): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  let pos = 0;
  while (pos + 168 <= data.length) {
    const block = new Uint8Array(TX802_PMEM_BLOCK);
    let ok = true;
    for (let i = 0; i < TX802_PMEM_BLOCK; i++) {
      const hi = hexNibble(data[pos++]);
      const lo = hexNibble(data[pos++]);
      if (hi < 0 || lo < 0) {
        ok = false;
        break;
      }
      block[i] = (hi << 4) | lo;
    }
    if (!ok) break;
    blocks.push(block);
    pos += 1;
    if (pos + 12 <= data.length && data[pos] === 0x0a) pos += 12;
  }
  return blocks;
}

function payloadFromFrame(frame: SysexFrame): Uint8Array | null {
  const raw = frame.raw;
  if (raw.length < 8) return null;
  const size = (raw[4] << 7) | raw[5];
  if (size <= 0 || 6 + size > raw.length) return null;
  let data = raw.subarray(6, 6 + size);
  if (frame.format === 0x7e && data.length > 10) data = data.subarray(10);
  return data;
}

function isTx802PmemBank(frame: SysexFrame): boolean {
  return frame.formatId?.includes('8952PM') ?? false;
}

/** Extract performances from a SysEx frame, or null if unsupported. */
export function performancesFromFrame(frame: SysexFrame): ParsedPerformance[] | null {
  if (!TX802_PERF_KINDS.has(frame.kind)) return null;
  const data = payloadFromFrame(frame);
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

/** @deprecated Use decodeDx7iiVoiceRef */
export function mapVoiceNumber(vnum: number): number {
  return decodeDx7iiVoiceRef(vnum).program;
}

export { defaultVoiceRef, type VoiceRef };

