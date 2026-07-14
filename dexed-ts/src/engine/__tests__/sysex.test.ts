import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  splitSysex,
  identifySysex,
  identifyFrame,
  SysexKind,
  voiceFromVced,
  vcedFromVoice,
  cartridgeFromSyx,
  cartridgeFromVoices,
} from '../sysex';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string): Uint8Array => new Uint8Array(readFileSync(join(here, 'fixtures', name)));

describe('splitSysex', () => {
  it('splits a concatenated file into individual F0..F7 frames', () => {
    const frames = splitSysex(fx('tx802-prg1.syx'));
    // param-change + format-6 performance + 32-voice VMEM
    expect(frames.length).toBe(3);
    for (const f of frames) {
      expect(f[0]).toBe(0xf0);
      expect(f[f.length - 1]).toBe(0xf7);
    }
  });

  it('returns a single frame for a plain cartridge', () => {
    expect(splitSysex(fx('rom1a.syx')).length).toBe(1);
  });
});

describe('identifySysex — golden fixtures', () => {
  it('recognizes a 32-voice VMEM cartridge', () => {
    const [frame] = identifySysex(fx('rom1a.syx'));
    expect(frame.kind).toBe(SysexKind.Cartridge);
    expect(frame.format).toBe(0x09);
    expect(frame.checksumOk).toBe(true);
  });

  it('recognizes a DX7II performance memory (LM  8973PM)', () => {
    const [frame] = identifySysex(fx('dx7ii-perf.syx'));
    expect(frame.kind).toBe(SysexKind.Dx7iiPerformance);
    expect(frame.formatId).toBe('LM  8973PM');
    expect(frame.checksumOk).toBe(true);
  });

  it('recognizes a DX5/DX1 performance memory (format 2)', () => {
    // Note: DX1/DX5 format-2 dumps use a different checksum convention than
    // the DX7 family, so only identification is asserted here.
    const [frame] = identifySysex(fx('dx5-perf.syx'));
    expect(frame.kind).toBe(SysexKind.Dx5Performance);
    expect(frame.format).toBe(0x02);
  });

  it('recognizes a TX802 bank file as param-change + AMEM + cartridge', () => {
    const frames = identifySysex(fx('tx802-prg1.syx'));
    expect(frames.map((f) => f.kind)).toEqual([
      SysexKind.ParamChange,
      SysexKind.Amem,
      SysexKind.Cartridge,
    ]);
    expect(frames[1].format).toBe(0x06);
    expect(frames[1].checksumOk).toBe(true);
    expect(frames[2].checksumOk).toBe(true);
  });

  it('recognizes DX7II cartridge fractional-scaling blocks', () => {
    const frames = identifySysex(fx('dx7ii-cart.syx'));
    expect(frames[0].kind).toBe(SysexKind.ParamChange);
    const scale = frames.filter((f) => f.kind === SysexKind.FractionalScale);
    expect(scale.length).toBeGreaterThan(0);
    expect(scale[0].formatId?.startsWith('LM  FKS')).toBe(true);
  });
});

describe('VCED round-trip', () => {
  it('serializes and parses a voice back byte-for-byte', () => {
    const cart = cartridgeFromSyx(fx('rom1a.syx'))!;
    const voice = cart.unpackProgram(0);
    const vced = vcedFromVoice(voice);
    expect(vced.length).toBe(163);
    expect(identifyFrame(vced).kind).toBe(SysexKind.Voice);
    expect(identifyFrame(vced).checksumOk).toBe(true);
    const back = voiceFromVced(vced)!;
    expect(Array.from(back)).toEqual(Array.from(voice));
  });
});

describe('VMEM pack/unpack round-trip', () => {
  it('repacks 32 unpacked voices to the original packed bytes', () => {
    const original = cartridgeFromSyx(fx('rom1a.syx'))!;
    const voices = Array.from({ length: 32 }, (_, i) => original.unpackProgram(i));
    const repacked = cartridgeFromVoices(voices);
    // Compare the packed voice region (6 .. 6+4096) byte-for-byte.
    const a = original.voiceData.subarray(6, 6 + 4096);
    const b = repacked.voiceData.subarray(6, 6 + 4096);
    expect(Array.from(b)).toEqual(Array.from(a));
    // ...and the recomputed checksum matches the original dump.
    expect(repacked.voiceData[6 + 4096]).toBe(original.voiceData[6 + 4096]);
  });

  it('preserves program names through pack/unpack', () => {
    const original = cartridgeFromSyx(fx('rom1a.syx'))!;
    const voices = Array.from({ length: 32 }, (_, i) => original.unpackProgram(i));
    const repacked = cartridgeFromVoices(voices);
    expect(repacked.programNames()).toEqual(original.programNames());
  });
});
