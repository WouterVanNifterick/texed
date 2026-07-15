import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSysexFile } from '../sysex-loader';
import { SynthRack } from '../synth-rack';

const here = dirname(fileURLToPath(import.meta.url));
const factory = join(here, '../../../../patches/TX802_Factory/original');
const load = (name: string) => new Uint8Array(readFileSync(join(factory, name)));

describe('TX802 incremental load', () => {
  it('merges banks then performances without losing either', () => {
    const rack = new SynthRack(44100);
    const banks = loadSysexFile(
      new Uint8Array([
        ...load('A1.SYX'),
        ...load('A2.SYX'),
        ...load('B1.SYX'),
        ...load('B2.SYX'),
      ]),
    );
    rack.loadLibrary(banks.library);

    const perfs = loadSysexFile(load('P.SYX'));
    rack.loadLibrary(perfs.library);

    expect(rack.voiceLibrary.populatedBanks().length).toBe(4);
    expect(rack.voiceLibrary.performances.length).toBe(64);
    rack.selectPerformance(0);
    const hall = rack.voiceLibrary.performances.find((p) => p.name.includes('Hall'))!;
    rack.selectPerformance(rack.voiceLibrary.performances.indexOf(hall));
    const part0 = rack.getPartConfig(0);
    expect(part0.voice).toEqual({ bank: 'internalA', program: 9 });
    expect(part0.voiceLabel).toContain('FrenchHorn');
  });
});
