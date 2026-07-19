import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildManifest,
  describeSyxFile,
  fs1rVoiceNameFromFilename,
  packFs1rBank,
  slugifyPath,
  type SourceFile,
} from '../patch-library-core.mts';
import { loadSysexFile } from '@texed/dx7-format/sysex-loader';
import { getVoiceName } from '@texed/dx7-format/params';

const here = dirname(fileURLToPath(import.meta.url));
const patchesDir = join(here, '../../../patches');

describe('fs1rVoiceNameFromFilename', () => {
  it('strips the index prefix and extension', () => {
    expect(fs1rVoiceNameFromFilename('0.003 MM-Piano 1.Dx7Voice')).toBe('MM-Piano 1');
    expect(fs1rVoiceNameFromFilename('Bank 0/0.098 3D Road.Dx7Voice')).toBe('3D Road');
  });
});

describe('packFs1rBank — real Bank 0', () => {
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

describe('describeSyxFile', () => {
  it('describes a TX802 factory voice bank', () => {
    const bytes = new Uint8Array(readFileSync(join(patchesDir, 'TX802_Factory/original/A1.SYX')));
    const desc = describeSyxFile(bytes);
    expect(desc.banks.length).toBe(1);
    expect(desc.banks[0].voices.length).toBe(32);
    expect(desc.banks[0].hasAmem).toBe(true);
    expect(desc.performanceNames.length).toBe(0);
    expect(desc.selfContained).toBe(false);
  });

  it('flags a combined banks+performances file as self-contained', () => {
    const bytes = new Uint8Array(readFileSync(join(patchesDir, 'DX7II_Collections/Ajay/ajay.syx')));
    const desc = describeSyxFile(bytes);
    expect(desc.banks.map((b) => b.sourceBank)).toEqual(['internalA', 'internalB']);
    expect(desc.performanceNames.length).toBe(32);
    expect(desc.selfContained).toBe(true);
  });

  it('describes the TX802 factory performance file (perfs only)', () => {
    const bytes = new Uint8Array(readFileSync(join(patchesDir, 'TX802_Factory/original/P.SYX')));
    const desc = describeSyxFile(bytes);
    expect(desc.banks.length).toBe(0);
    expect(desc.performanceNames.length).toBe(64);
    expect(desc.performanceNames[0]).toBe('Hall Orchestra');
    expect(desc.selfContained).toBe(false);
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

  it('accepts a valid manifest', () => {
    const m = buildManifest([{ id: 'c', name: 'C', banks: [bank], performanceSets: [] }]);
    expect(m.schema).toBe(1);
    expect(m.collections.length).toBe(1);
  });

  it('rejects duplicates and empty content', () => {
    expect(() => buildManifest([])).toThrow();
    const col = { id: 'c', name: 'C', banks: [bank], performanceSets: [] };
    expect(() => buildManifest([col, col])).toThrow(/duplicate/);
    expect(() =>
      buildManifest([
        { id: 'c', name: 'C', banks: [{ ...bank, voices: [] }], performanceSets: [] },
      ]),
    ).toThrow(/no voices/);
  });
});
