// Build the built-in patch library: scan ../patches and emit
// public/library/manifest.json plus bank blobs / verbatim .syx copies.
// Run via `pnpm build:library` (chained into `pnpm dev` and `pnpm build`).

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildManifest,
  describeSyxFile,
  packFs1rBank,
  slugifyPath,
  type SourceFile,
} from './patch-library-core.mts';
import type { LibBank, LibCollection, LibPerfSet } from '../src/state/library-manifest';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const PATCHES_DIR = path.resolve(scriptDir, '..', '..', 'patches');
const OUT_DIR = path.resolve(scriptDir, '..', 'public', 'library');

interface CollectionSpec {
  id: string;
  name: string;
  /** Directory under patches/. */
  dir: string;
  kind: 'fs1r' | 'syx';
  /**
   * For performance-only files: rel path (forward slashes) → the voice bank
   * files (in internalA..cartridgeB order) the performances reference.
   */
  perfBankMap?: Record<string, string[]>;
}

const COLLECTIONS: CollectionSpec[] = [
  { id: 'fs1r', name: 'DX7 Voices from FS1R', dir: 'DX7 Voices from FS1R', kind: 'fs1r' },
  {
    id: 'tx802-factory',
    name: 'TX802 Factory',
    dir: 'TX802_Factory',
    kind: 'syx',
    perfBankMap: {
      'original/P.SYX': ['original/A1.SYX', 'original/A2.SYX', 'original/B1.SYX', 'original/B2.SYX'],
      'fmori/perf_1-64.syx': ['fmori/voice_1-32.syx', 'fmori/voice_33-64.syx'],
    },
  },
  { id: 'tx802-collections', name: 'TX802 Collections', dir: 'TX802_Collections', kind: 'syx' },
  { id: 'dx7iifd-factory', name: 'DX7IIFD Factory', dir: 'DX7IIFD_Factory', kind: 'syx' },
  { id: 'dx7s-factory', name: 'DX7s Factory', dir: 'DX7s_Factory', kind: 'syx' },
  { id: 'dx5', name: 'DX5', dir: 'DX5', kind: 'syx' },
  { id: 'dx7ii-collections', name: 'DX7II Collections', dir: 'DX7II_Collections', kind: 'syx' },
  { id: 'dx7ii-freeware', name: 'DX7II Yamaha Freeware', dir: 'DX7II_Yamaha_Freeware', kind: 'syx' },
];

/** All files under `root`, as collection-relative forward-slash paths, sorted. */
async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).replaceAll(path.sep, '/'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

async function writeOut(relPath: string, data: Uint8Array | string): Promise<void> {
  const abs = path.join(OUT_DIR, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

function fileStem(relPath: string): string {
  return relPath.split('/').pop()!.replace(/\.[^.]+$/, '');
}

async function buildFs1rCollection(spec: CollectionSpec): Promise<LibCollection> {
  const root = path.join(PATCHES_DIR, spec.dir);
  const banks: LibBank[] = [];
  const bankDirs = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  for (const dirName of bankDirs) {
    const bankRoot = path.join(root, dirName);
    const voiceFiles = (await walkFiles(bankRoot)).filter((f) => /\.dx7voice$/i.test(f));
    if (voiceFiles.length === 0) continue;
    const files: SourceFile[] = await Promise.all(
      voiceFiles.map(async (f) => ({ path: f, data: new Uint8Array(await readFile(path.join(bankRoot, f))) })),
    );
    const { blob, names } = packFs1rBank(files);
    const n = dirName.replace(/\D+/g, '') || dirName;
    const file = `${spec.id}/bank-${n}.vced.bin`;
    await writeOut(file, blob);
    banks.push({ id: `${spec.id}/bank-${n}`, name: `Bank ${n}`, file, format: 'vced155', voices: names });
  }
  return { id: spec.id, name: spec.name, banks, performanceSets: [] };
}

async function buildSyxCollection(spec: CollectionSpec): Promise<LibCollection> {
  const root = path.join(PATCHES_DIR, spec.dir);
  const banks: LibBank[] = [];
  const performanceSets: LibPerfSet[] = [];
  const copiedPath = (rel: string): string => `${spec.id}/${slugifyPath(rel)}`;

  const syxFiles = (await walkFiles(root)).filter((f) => /\.syx$/i.test(f));
  for (const rel of syxFiles) {
    const bytes = new Uint8Array(await readFile(path.join(root, rel)));
    const desc = describeSyxFile(bytes);
    if (desc.banks.length === 0 && desc.performanceNames.length === 0) {
      console.warn(`  skip (nothing recognized): ${spec.dir}/${rel}`);
      continue;
    }
    const outFile = copiedPath(rel);
    await writeOut(outFile, bytes);
    const stem = fileStem(rel);

    for (const b of desc.banks) {
      banks.push({
        id: `${outFile}#${b.sourceBank}`,
        name: desc.banks.length > 1 ? `${stem} · ${b.label}` : stem,
        file: outFile,
        format: 'syx',
        sourceBank: b.sourceBank,
        hasAmem: b.hasAmem,
        voices: b.voices,
      });
    }

    if (desc.performanceNames.length > 0) {
      const mapped = spec.perfBankMap?.[rel];
      performanceSets.push({
        id: `${outFile}#perf`,
        name: stem,
        file: outFile,
        names: desc.performanceNames,
        requiresBankFiles: desc.selfContained ? [] : (mapped ?? []).map(copiedPath),
      });
    }
  }
  return { id: spec.id, name: spec.name, banks, performanceSets };
}

async function main(): Promise<void> {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const collections: LibCollection[] = [];
  for (const spec of COLLECTIONS) {
    console.log(`collection: ${spec.name}`);
    const col = spec.kind === 'fs1r' ? await buildFs1rCollection(spec) : await buildSyxCollection(spec);
    if (col.banks.length === 0 && col.performanceSets.length === 0) {
      console.warn(`  empty collection, dropped: ${spec.id}`);
      continue;
    }
    collections.push(col);
  }

  const manifest = buildManifest(collections);
  await writeOut('manifest.json', JSON.stringify(manifest));

  const nBanks = collections.reduce((a, c) => a + c.banks.length, 0);
  const nVoices = collections.reduce((a, c) => a + c.banks.reduce((x, b) => x + b.voices.length, 0), 0);
  const nPerfs = collections.reduce((a, c) => a + c.performanceSets.reduce((x, p) => x + p.names.length, 0), 0);
  console.log(`library: ${collections.length} collections, ${nBanks} banks, ${nVoices} voices, ${nPerfs} performances`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
