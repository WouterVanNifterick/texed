import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSysexFile } from '../sysex-loader';
import { identifySysex, SysexKind, voiceFromRawVced } from '../sysex';
import { performancesFromFrame } from '../performance';
import { decodeDx7iiVoiceRef } from '../voice-library';
import { getVoiceName } from '../../state/params';

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

describe('loadSysexFile — raw VCED (.Dx7Voice)', () => {
  const fs1r = (name: string) =>
    new Uint8Array(
      readFileSync(join(here, '../../../../patches/DX7 Voices from FS1R/Bank 0', name)),
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
