import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSysexFile } from '../sysex-loader';
import { identifySysex, SysexKind } from '../sysex';
import { performancesFromFrame } from '../performance';
import { decodeDx7iiVoiceRef } from '../voice-library';

const here = dirname(fileURLToPath(import.meta.url));
const patch = (rel: string) =>
  new Uint8Array(readFileSync(join(here, '../../../../patches', rel)));
const fx = (name: string) =>
  new Uint8Array(readFileSync(join(here, 'fixtures', name)));

describe('loadSysexFile — ajay.syx', () => {
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

describe('loadSysexFile — TX7 cassette', () => {
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

  it('loads both bank groups, AMEM, performances, and system setup', () => {
    expect(result.library.populatedBanks()).toContain('internalA');
    expect(result.library.populatedBanks()).toContain('cartridgeA');
    expect(result.library.performances.length).toBe(32);
    expect(result.library.systemSetup).not.toBeNull();
    expect(result.report.applied.some((a) => a.includes('8973S'))).toBe(true);
  });
});

describe('loadSysexFile — tx802 regression', () => {
  it('still loads TX802 performance + VMEM', () => {
    const result = loadSysexFile(fx('tx802-prg1.syx'));
    expect(result.loaded).toBe(true);
    expect(result.library.populatedBanks()).toContain('internalA');
    const frames = identifySysex(fx('tx802-prg1.syx'));
    const perf = frames.find((f) => f.kind === SysexKind.Performance);
    expect(perf).toBeDefined();
    const perfs = performancesFromFrame(perf!);
    expect(perfs?.length).toBe(1);
  });
});
