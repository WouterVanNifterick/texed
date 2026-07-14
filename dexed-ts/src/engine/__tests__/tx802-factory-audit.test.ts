import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSysexFile } from '../sysex-loader';
import { OP } from '../../state/params';

const here = dirname(fileURLToPath(import.meta.url));
const factory = join(here, '../../../../patches/TX802_Factory/original');

function loadFactoryCombined(): ReturnType<typeof loadSysexFile> {
  const files = ['A1.SYX', 'A2.SYX', 'B1.SYX', 'B2.SYX', 'P.SYX'];
  const combined = files.reduce((acc, f) => {
    const b = readFileSync(join(factory, f));
    const out = new Uint8Array(acc.length + b.length);
    out.set(acc);
    out.set(b, acc.length);
    return out;
  }, new Uint8Array(0));
  return loadSysexFile(combined);
}

describe('TX802 factory original', () => {
  const result = loadFactoryCombined();

  it('loads four voice banks with AMEM and 64 performances', () => {
    expect(result.loaded).toBe(true);
    expect(result.library.populatedBanks()).toEqual([
      'internalA',
      'internalB',
      'cartridgeA',
      'cartridgeB',
    ]);
    expect(result.library.performances.length).toBe(64);
    expect(result.report.applied.filter((a) => a.match(/^AMEM →/)).length).toBe(4);
  });

  it('unpacks operator detune from VMEM (not always centered at 7)', () => {
    let nonCenter = 0;
    for (const bank of result.library.populatedBanks()) {
      for (let p = 0; p < 32; p++) {
        const slot = result.library.resolve({ bank, program: p });
        if (!slot) continue;
        for (let op = 1; op <= 6; op++) {
          if (slot.vmem[OP.detune + (6 - op) * 21] !== 7) nonCenter++;
        }
      }
    }
    expect(nonCenter).toBeGreaterThan(100);
  });

  it('parses performance part detune from P.SYX TPMEM bank', () => {
    const withDetune = result.library.performances.filter((perf) =>
      perf.parts.some((p) => p.enabled && p.detune !== 0),
    );
    expect(withDetune.length).toBeGreaterThan(0);
    const hall = result.library.performances.find((p) => p.name.includes('Hall'));
    expect(hall?.parts.filter((p) => p.enabled).map((p) => p.detune)).toContain(2);
  });

  it('resolves Hall Orchestra voices with TX802 1-based numbering', () => {
    const hall = result.library.performances.find((p) => p.name.includes('Hall'));
    expect(hall).toBeDefined();
    const enabled = hall!.parts.filter((p) => p.enabled);
    expect(enabled[0]?.voice).toEqual({ bank: 'internalA', program: 9 }); // voice 10 = FrenchHorn
    expect(enabled[3]?.voice).toEqual({ bank: 'internalA', program: 12 }); // voice 13 = NewOrchest
  });

  it('pans Stereo ElectricPiano parts to opposite outputs', () => {
    const stereo = result.library.performances.find((p) => p.name.includes('Stereo'));
    expect(stereo).toBeDefined();
    const pans = stereo!.parts.filter((p) => p.enabled).map((p) => p.pan);
    expect(pans).toContain(-1);
    expect(pans).toContain(1);
  });

  it('reports performances (64) in combined load report', () => {
    expect(result.report.applied).toContain('performances (64)');
  });

  it('disables Reverb Brass parts with voice 0', () => {
    const reverb = result.library.performances.find((p) => p.name.includes('Reverb'));
    expect(reverb).toBeDefined();
    const enabled = reverb!.parts.filter((p) => p.enabled);
    expect(enabled.length).toBe(2);
    expect(enabled[0]?.voice).toEqual({ bank: 'internalA', program: 1 }); // voice 2 = SilvaBrass
  });

  it('has empty names for unused factory slots 55–64', () => {
    for (let i = 54; i < 64; i++) {
      expect(result.library.performances[i]?.name.trim()).toBe('');
    }
  });
});
