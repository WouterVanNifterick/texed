import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseTx802PmemBlock,
  parseDx7iiPerfBlock,
  performancesFromFrame,
  TX802_PMEM_BLOCK,
  DX7II_PERF_BLOCK,
} from '../performance';
import { SysexKind, identifySysex, type SysexFrame } from '../sysex';
import { decodeDx7iiVoiceRef } from '../voice-library';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string): Uint8Array => new Uint8Array(readFileSync(join(here, 'fixtures', name)));
const patchPath = (rel: string): Uint8Array =>
  new Uint8Array(readFileSync(join(here, '../../../../patches', rel)));

function makeTx802PmemBlock(name = 'TEST PERFORMANCE NAM '): Uint8Array {
  const block = new Uint8Array(TX802_PMEM_BLOCK);
  block[0] = 0x00;
  block[8] = 69;
  block[24] = 99;
  block[32] = 0x3b;
  block[40] = 36;
  block[48] = 96;
  block[56] = 24;
  for (let i = 0; i < 20; i++) block[64 + i] = name.charCodeAt(i) & 0x7f;
  return block;
}

function makeDx7iiPerfFrame(blocks: Uint8Array[]): SysexFrame {
  const dataLen = blocks.length * DX7II_PERF_BLOCK;
  const raw = new Uint8Array(6 + 10 + dataLen + 2);
  raw.set([0xf0, 0x43, 0x00, 0x7e, ((10 + dataLen) >> 7) & 0x7f, (10 + dataLen) & 0x7f], 0);
  raw.set([0x4c, 0x4d, 0x20, 0x20, 0x38, 0x39, 0x37, 0x33, 0x50, 0x4d], 6);
  for (let i = 0; i < blocks.length; i++) raw.set(blocks[i], 16 + i * DX7II_PERF_BLOCK);
  raw[16 + dataLen] = 0;
  raw[16 + dataLen + 1] = 0xf7;
  return { kind: SysexKind.Dx7iiPerformance, raw, channel: 0, format: 0x7e, formatId: 'LM  8973PM' };
}

describe('parseTx802PmemBlock', () => {
  it('extracts name, detune center, and per-part mapping', () => {
    const { name, parts } = parseTx802PmemBlock(makeTx802PmemBlock());
    expect(name).toBe('TEST PERFORMANCE NAM');
    expect(parts[0]).toMatchObject({
      enabled: true,
      rxChannel: 1,
      voice: { bank: 'internalA', program: 5 },
      volume: 1,
      detune: 0,
      noteLow: 36,
      noteHigh: 96,
      noteShift: 0,
    });
  });
});

describe('parseDx7iiPerfBlock', () => {
  it('maps dual mode to two enabled parts with bank-aware voice refs', () => {
    const block = new Uint8Array(DX7II_PERF_BLOCK);
    block[0] = 1;
    block[1] = 10;
    block[2] = 52;
    for (let i = 0; i < 20; i++) block[31 + i] = 'Dual Test Perf'.charCodeAt(i) & 0x7f;
    const { name, parts } = parseDx7iiPerfBlock(block);
    expect(name).toBe('Dual Test Perf');
    expect(parts[0]?.voice).toEqual(decodeDx7iiVoiceRef(10));
    expect(parts[1]?.voice).toEqual(decodeDx7iiVoiceRef(52));
    expect(parts[1]?.voice).toEqual({ bank: 'internalB', program: 20 });
  });
});

describe('performancesFromFrame — fixtures', () => {
  it('parses TX802 combo performance frame (format 0x06)', () => {
    const frames = identifySysex(fx('tx802-prg1.syx'));
    const perf = frames.find((f) => f.kind === SysexKind.Performance)!;
    const perfs = performancesFromFrame(perf);
    expect(perfs!.length).toBe(1);
    expect(perfs![0].parts[0]).toMatchObject({
      enabled: true,
      rxChannel: 0,
      voice: { bank: 'internalA', program: 31 },
    });
  });
});

describe('decodeDx7iiVoiceRef', () => {
  it('maps internal high voices to internalB', () => {
    expect(decodeDx7iiVoiceRef(52)).toEqual({ bank: 'internalB', program: 20 });
  });
  it('maps cartridge voices to cartridge banks', () => {
    expect(decodeDx7iiVoiceRef(64)).toEqual({ bank: 'cartridgeA', program: 0 });
    expect(decodeDx7iiVoiceRef(96)).toEqual({ bank: 'cartridgeB', program: 0 });
  });
});
