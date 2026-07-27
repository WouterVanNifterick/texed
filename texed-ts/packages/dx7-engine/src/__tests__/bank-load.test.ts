import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSysexFile } from '@texed/dx7-format/sysex-loader';
import { identifySysex, SysexKind, voiceFromRawVced } from '@texed/dx7-format/sysex';
import { decodeDx7iiVoiceRef } from '@texed/dx7-format/voice-library';
import { getVoiceName } from '@texed/dx7-format/voice';

const here = dirname(fileURLToPath(import.meta.url));
const patch = (rel: string) =>
  new Uint8Array(readFileSync(join(here, '../../../../../patches', rel)));
const fx = (name: string) => new Uint8Array(readFileSync(join(here, 'fixtures', name)));

describe('loadSysexFile - ajay.syx', () => {
  const result = loadSysexFile(patch('DX7II_Collections/Ajay/ajay.syx'));

  it('loads two internal VMEM halves and 32 performances', () => {
    expect(result.loaded).toBe(true);
    expect(result.library.populatedBanks()).toEqual(['internalA', 'internalB']);
    expect(result.library.performances.length).toBe(32);
  });

  it('resolves voiceB=52 to internalB program 20', () => {
    const perf = result.library.performances.find((p) => p.name.includes('TOTEM'));
    expect(perf).toBeDefined();
    const part1 = perf!.parts[1];
    expect(part1?.voice).toEqual(decodeDx7iiVoiceRef(52));
  });
});

describe('loadSysexFile - TX7 cassette', () => {
  const bytes = patch('DX7II_Collections/12-op/TX7_Cassette_ADAPTED_DX7iiD_FD_by12op.syx');
  const frames = identifySysex(bytes);
  const result = loadSysexFile(bytes);

  it('identifies all 10 frames correctly', () => {
    expect(frames.map((f) => f.kind)).toEqual([
      SysexKind.ParamChange,
      SysexKind.Amem,
      SysexKind.Cartridge,
      SysexKind.ParamChange,
      SysexKind.Amem,
      SysexKind.Cartridge,
      SysexKind.Dx7iiPerformance,
      SysexKind.Microtune,
      SysexKind.Microtune,
      SysexKind.SystemSetup,
    ]);
  });

  // The two 4D param changes tag the halves of one 64-voice memory, not
  // internal-vs-cartridge; these performances reference INT slots only.
  it('loads both bank groups, AMEM, performances, and system setup', () => {
    expect(result.library.populatedBanks()).toEqual(['internalA', 'internalB']);
    expect(result.library.performances.length).toBe(32);
    expect(result.library.systemSetup).not.toBeNull();
    expect(result.report.applied.some((a) => a.includes('8973S'))).toBe(true);
  });

  it('resolves every referenced part voice', () => {
    const unresolved = result.library.performances
      .flatMap((p) => p.parts)
      .filter((part) => part.enabled !== false && part.voice)
      .filter((part) => !result.library.resolve(part.voice!));
    expect(unresolved).toEqual([]);
  });
});

/**
 * `F0 43 10 19 4D vv` selects the half of a 64-voice memory (0 = 1-32,
 * 1 = 33-64). Which memory - internal or cartridge - is only knowable from the
 * performances travelling with the dumps, so these files used to land half
 * their voices in the wrong bank and resolve part references to nothing.
 */
describe('loadSysexFile - VMEM half tags', () => {
  it('puts a tagged internal pair in internalA + internalB', () => {
    const lib = loadSysexFile(patch('DX7IIFD_Factory/INTERNAL.SYX')).library;
    expect(lib.populatedBanks()).toEqual(['internalA', 'internalB']);
  });

  it('puts a tagged cartridge pair in cartridgeA + cartridgeB', () => {
    const lib = loadSysexFile(patch('DX7s_Factory/CART.syx')).library;
    expect(lib.populatedBanks()).toEqual(['cartridgeA', 'cartridgeB']);
  });

  it('sends an untagged pair to the memory its performances reference', () => {
    // No 4D frames at all; the CRT references are the only signal.
    const lib = loadSysexFile(patch('DX7II_Collections/ChiNoMaki/A.syx')).library;
    expect(lib.populatedBanks()).toEqual(['cartridgeA', 'cartridgeB']);
  });

  it('places a lone dump where its performances point, ignoring the tag', () => {
    const lib = loadSysexFile(patch('DX7II_Collections/Jugosi/Dera DX7.syx')).library;
    expect(lib.populatedBanks()).toEqual(['internalB']);
  });

  it('defaults to internal for a plain bank dump with no performances', () => {
    const lib = loadSysexFile(patch('TX802_Collections/802PRG1.SYX')).library;
    expect(lib.populatedBanks()).toEqual(['internalA']);
  });

  it('sends a half-B bank dump to internalB', () => {
    const lib = loadSysexFile(patch('TX802_Collections/TXSEL_1B.SYX')).library;
    expect(lib.populatedBanks()).toEqual(['internalB']);
  });
});

describe('loadSysexFile - tx802 regression', () => {
  it('loads TX802 AMEM + VMEM from bank dump', () => {
    const result = loadSysexFile(fx('tx802-prg1.syx'));
    expect(result.loaded).toBe(true);
    expect(result.library.populatedBanks()).toContain('internalA');
    expect(result.report.applied.some((a) => a.startsWith('AMEM'))).toBe(true);
    expect(result.report.applied.some((a) => a.startsWith('VMEM'))).toBe(true);
    const frames = identifySysex(fx('tx802-prg1.syx'));
    const amem = frames.find((f) => f.kind === SysexKind.Amem);
    expect(amem).toBeDefined();
  });
});

describe('dumpBankSysex - AMEM + VMEM round-trip', () => {
  it('re-loading a dumped bank reproduces every voice and supplement byte', () => {
    const original = loadSysexFile(fx('tx802-prg1.syx')).library;
    const dump = original.dumpBankSysex('internalA');
    expect(dump).not.toBeNull();

    const frames = identifySysex(dump!);
    expect(frames.map((f) => f.kind)).toEqual([SysexKind.Amem, SysexKind.Cartridge]);
    expect(frames.every((f) => f.checksumOk)).toBe(true);

    const reloaded = loadSysexFile(dump!).library;
    for (let i = 0; i < 32; i++) {
      const a = original.resolve({ bank: 'internalA', program: i })!;
      const b = reloaded.resolve({ bank: 'internalA', program: i })!;
      expect(Array.from(b.vmem)).toEqual(Array.from(a.vmem));
      expect(Array.from(b.amem)).toEqual(Array.from(a.amem));
    }
  });

  it('returns null for an unpopulated bank', () => {
    const lib = loadSysexFile(fx('tx802-prg1.syx')).library;
    expect(lib.dumpBankSysex('cartridgeB')).toBeNull();
  });
});

describe('loadSysexFile - raw VCED (.Dx7Voice)', () => {
  const fs1r = (name: string) =>
    new Uint8Array(
      readFileSync(join(here, '../../../../../patches/DX7 Voices from FS1R/Bank 0', name)),
    );

  it('loads a single 155-byte FS1R voice into the selected part', () => {
    const bytes = fs1r('0.024 El.Grand 4.Dx7Voice');
    expect(bytes.length).toBe(155);
    expect(identifySysex(bytes).length).toBe(0);

    const result = loadSysexFile(bytes);
    expect(result.loaded).toBe(true);
    expect(result.singleVoice).not.toBeNull();
    expect(getVoiceName(result.singleVoice!)).toContain('El.Grand');
    expect(result.report.applied).toContain('raw VCED voice');
  });

  it('builds a VMEM bank from concatenated raw voices', () => {
    const combined = new Uint8Array(310);
    combined.set(fs1r('0.024 El.Grand 4.Dx7Voice'), 0);
    combined.set(fs1r('0.098 3D Road.Dx7Voice'), 155);

    const result = loadSysexFile(combined);
    expect(result.loaded).toBe(true);
    expect(result.singleVoice).toBeNull();
    expect(result.library.populatedBanks()).toEqual(['internalA']);
    expect(result.report.applied[0]).toBe('raw VCED bank (2 voices)');
    expect(getVoiceName(voiceFromRawVced(fs1r('0.098 3D Road.Dx7Voice'))!)).toContain('3D Road');
  });
});
