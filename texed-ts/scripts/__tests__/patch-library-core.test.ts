import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  assignSlots,
  buildManifest,
  describeSyxFile,
  fs1rVoiceNameFromFilename,
  groupDirectory,
  packFs1rBank,
  partnersForPerfBank,
  slugifyPath,
  type DescribedFile,
  type SourceFile,
} from '../patch-library-core.mts';
import { loadSysexFile } from '@texed/dx7-format/sysex-loader';
import { getVoiceName } from '@texed/dx7-format/voice';

const here = dirname(fileURLToPath(import.meta.url));
const patchesDir = join(here, '../../../patches');

describe('fs1rVoiceNameFromFilename', () => {
  it('strips the index prefix and extension', () => {
    expect(fs1rVoiceNameFromFilename('0.003 MM-Piano 1.Dx7Voice')).toBe('MM-Piano 1');
    expect(fs1rVoiceNameFromFilename('Bank 0/0.098 3D Road.Dx7Voice')).toBe('3D Road');
  });
});

describe('packFs1rBank - real Bank 0', () => {
  const bankDir = join(patchesDir, 'DX7 Voices from FS1R/Bank 0');
  const files: SourceFile[] = readdirSync(bankDir)
    .filter((f) => /\.dx7voice$/i.test(f))
    .map((f) => ({ path: f, data: new Uint8Array(readFileSync(join(bankDir, f))) }));
  const packed = packFs1rBank(files);

  it('packs 128 voices of 155 bytes each', () => {
    expect(files.length).toBe(128);
    expect(packed.blob.length).toBe(128 * 155);
    expect(packed.names.length).toBe(128);
  });

  it('slice N carries the voice named in file N', () => {
    // The whole blob loads as a raw VCED bank the engine already understands.
    const result = loadSysexFile(packed.blob);
    expect(result.loaded).toBe(true);
    const lib = result.library;
    // Only 32 fit a half-bank; compare the first 32 embedded VMEM names against
    // the filename-derived manifest names (prefix match: filenames may add
    // disambiguators, but both come from the same 10-char VCED name field).
    const names = lib.programNames('internalA');
    for (let i = 0; i < 32; i++) {
      expect(names[i].trim()).toBe(packed.names[i].slice(0, 10).trim());
    }
    // Spot-check a direct slice against its filename.
    const idx = files
      .map((f) => f.path)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .findIndex((p) => p.includes('El.Grand 4'));
    const voice = packed.blob.subarray(idx * 155, (idx + 1) * 155);
    expect(getVoiceName(new Uint8Array([...voice, 0x3f]))).toContain('El.Grand');
  });
});

const describePatch = (rel: string) =>
  describeSyxFile(new Uint8Array(readFileSync(join(patchesDir, rel))));

describe('describeSyxFile', () => {
  it('describes a TX802 factory voice bank', () => {
    const desc = describePatch('TX802_Factory/A1.SYX');
    expect(desc.banks.length).toBe(1);
    expect(desc.banks[0].voices.length).toBe(32);
    expect(desc.banks[0].hasAmem).toBe(true);
    expect(desc.banks[0].amemVoices.length).toBeGreaterThan(0);
    expect(desc.performanceNames.length).toBe(0);
    expect(desc.selfContained).toBe(false);
  });

  it('flags a combined banks+performances file as self-contained', () => {
    const desc = describePatch('DX7II_Collections/Ajay/ajay.syx');
    expect(desc.banks.map((b) => b.sourceBank)).toEqual(['internalA', 'internalB']);
    expect(desc.refs).toEqual(['internalA', 'internalB']);
    expect(desc.performanceNames.length).toBe(32);
    expect(desc.selfContained).toBe(true);
  });

  it('is not self-contained when performances reach outside the file', () => {
    // A cartridge save whose performances also use internal voices.
    const desc = describePatch('DX7IIFD_Factory/CART.SYX');
    expect(desc.banks.map((b) => b.sourceBank)).toEqual(['cartridgeA', 'cartridgeB']);
    expect(desc.refs).toContain('internalA');
    expect(desc.selfContained).toBe(false);
  });

  it('describes the TX802 factory performance file (perfs only)', () => {
    const desc = describePatch('TX802_Factory/P.SYX');
    expect(desc.banks.length).toBe(0);
    expect(desc.performanceNames.length).toBe(64);
    expect(desc.performanceNames[0]).toBe('Hall Orchestra');
    expect(desc.refs).toEqual(['internalA', 'internalB', 'cartridgeA', 'cartridgeB']);
    expect(desc.selfContained).toBe(false);
  });

  it('records extras riding along in the file', () => {
    const desc = describePatch('DX7II_Collections/12-op/TX7_Cassette_ADAPTED_DX7iiD_FD_by12op.syx');
    expect(desc.extras).toEqual({ microtunings: 2, systemSetup: true });
  });

  it('marks a file the loader cannot read as unsupported', () => {
    const desc = describePatch('DX5/DX5 Performance_factory.syx');
    expect(desc.supported).toBe(false);
  });
});

// ==== grouping ====

/** Directory the next `described()` calls resolve against. */
let groupRoot = '';
const described = (rel: string): DescribedFile => ({
  rel,
  outFile: `col/${slugifyPath(rel)}`,
  stem: rel
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, ''),
  desc: describePatch(`${groupRoot}/${rel}`),
});

describe('partnersForPerfBank', () => {
  it('honours an explicit override', () => {
    groupRoot = 'TX802_Factory';
    const perf = described('P.SYX');
    const banks = ['A1.SYX', 'A2.SYX', 'B1.SYX', 'B2.SYX'].map(described);
    const picked = partnersForPerfBank(perf, banks, ['B2.SYX', 'A1.SYX']);
    expect(picked.map((f) => f.rel)).toEqual(['B2.SYX', 'A1.SYX']);
  });

  it('pairs a Perfs file with the Voices file beside it', () => {
    groupRoot = 'TX802_Collections/Drum_Sounds_Coffeeshoped';
    const perf = described('TX802-Cfshpd-Drum-Perfs.syx');
    const voices = described('TX802-Cfshpd-Drum-Voices.syx');
    expect(partnersForPerfBank(perf, [voices]).map((f) => f.rel)).toEqual([voices.rel]);
  });

  it('adopts a small directory when no name hint matches', () => {
    groupRoot = 'TX802_Factory';
    const perf = described('P.SYX');
    const banks = ['A1.SYX', 'A2.SYX'].map(described);
    expect(partnersForPerfBank(perf, banks).length).toBe(2);
  });
});

describe('assignSlots', () => {
  it('keeps each bank in the half-bank it came from', () => {
    groupRoot = 'TX802_Factory';
    const a1 = described('A1.SYX');
    const slots = assignSlots([a1], []);
    expect(slots).toEqual([{ slot: 'internalA', bankId: `${a1.outFile}#internalA` }]);
  });

  it('spreads colliding banks over the referenced slots first', () => {
    groupRoot = 'TX802_Factory';
    // A1, A2, B1, B2 all describe as internalA; they must fan out over all four.
    const files = ['A1.SYX', 'A2.SYX', 'B1.SYX', 'B2.SYX'].map(described);
    const slots = assignSlots(files, ['internalA', 'internalB', 'cartridgeA', 'cartridgeB']);
    expect(slots.map((s) => s.slot)).toEqual([
      'internalA',
      'internalB',
      'cartridgeA',
      'cartridgeB',
    ]);
    expect(slots[1].bankId).toBe(`${files[1].outFile}#internalA`);
  });
});

describe('groupDirectory', () => {
  it('wires the TX802 factory performance bank to its four voice banks', () => {
    groupRoot = 'TX802_Factory';
    const files = ['A1.SYX', 'A2.SYX', 'B1.SYX', 'B2.SYX', 'P.SYX'].map(described);
    const { sets, warnings } = groupDirectory('TX802_Factory', files, [], {
      'P.SYX': ['A1.SYX', 'A2.SYX', 'B1.SYX', 'B2.SYX'],
    });
    expect(warnings).toEqual([]);
    expect(sets.length).toBe(1);
    expect(sets[0].kind).toBe('performance');
    expect(sets[0].performances?.length).toBe(64);
    expect(sets[0].slots.map((s) => s.slot)).toEqual([
      'internalA',
      'internalB',
      'cartridgeA',
      'cartridgeB',
    ]);
    expect(sets[0].unresolvedSlots).toBeUndefined();
  });

  it('leaves a self-contained file as its own set', () => {
    groupRoot = 'DX7II_Collections/Ajay';
    const { sets } = groupDirectory('Ajay', [described('ajay.syx')], []);
    expect(sets.length).toBe(1);
    expect(sets[0].kind).toBe('performance');
    expect(sets[0].slots.map((s) => s.slot)).toEqual(['internalA', 'internalB']);
  });

  it('makes a voice-only set for banks nothing references', () => {
    groupRoot = 'TX802_Collections';
    const { sets } = groupDirectory('TX802_Collections', [described('802PRG1.SYX')], []);
    expect(sets.length).toBe(1);
    expect(sets[0].kind).toBe('voices');
    expect(sets[0].performances).toBeUndefined();
  });

  it('gives unreadable files an entry of their own when there is no obvious home', () => {
    groupRoot = 'DX5';
    const { sets, warnings } = groupDirectory(
      'DX5',
      [described('DX5A1.SYX')],
      ['DX5 Performance_factory.syx'],
    );
    const orphan = sets.find((s) => s.unsupported);
    expect(orphan?.unsupported).toEqual(['DX5 Performance_factory.syx']);
    expect(orphan?.slots).toEqual([]);
    expect(warnings[0]).toContain('nothing the loader recognizes');
  });

  it("hangs unreadable files off the directory's single performance set", () => {
    groupRoot = 'DX7II_Collections/Ajay';
    const { sets } = groupDirectory('Ajay', [described('ajay.syx')], ['notes.syx']);
    expect(sets.length).toBe(1);
    expect(sets[0].unsupported).toEqual(['notes.syx']);
  });
});

describe('slugifyPath', () => {
  it('makes URL-safe per-segment slugs', () => {
    expect(slugifyPath('original/P.SYX')).toBe('original/p.syx');
    expect(slugifyPath('Dave Phillips/TX Bank 1.syx')).toBe('dave-phillips/tx-bank-1.syx');
  });
});

describe('buildManifest', () => {
  const bank = { id: 'c/b', name: 'B', file: 'c/b.bin', format: 'vced155' as const, voices: ['X'] };
  const set = {
    id: 'c/b#set',
    name: 'B',
    kind: 'voices' as const,
    slots: [{ slot: 'internalA' as const, bankId: 'c/b' }],
  };

  it('accepts a valid manifest', () => {
    const m = buildManifest([{ id: 'c', name: 'C', banks: [bank], sets: [set] }]);
    expect(m.schema).toBe(2);
    expect(m.collections.length).toBe(1);
  });

  it('rejects duplicates and empty content', () => {
    expect(() => buildManifest([])).toThrow();
    const col = { id: 'c', name: 'C', banks: [bank], sets: [set] };
    expect(() => buildManifest([col, col])).toThrow(/duplicate/);
    expect(() =>
      buildManifest([{ id: 'c', name: 'C', banks: [{ ...bank, voices: [] }], sets: [set] }]),
    ).toThrow(/no voices/);
  });

  it('rejects a set wired to a bank that is not there', () => {
    expect(() =>
      buildManifest([
        {
          id: 'c',
          name: 'C',
          banks: [bank],
          sets: [{ ...set, slots: [{ slot: 'internalA' as const, bankId: 'c/missing' }] }],
        },
      ]),
    ).toThrow(/unknown bank/);
  });
});
