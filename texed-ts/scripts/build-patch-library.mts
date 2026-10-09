// Build the built-in patch library: scan ../patches and emit
// public/library/manifest.json plus bank blobs / verbatim .syx copies.
// Run via `pnpm build:library` (chained into `pnpm dev` and `pnpm build`).

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bankIdOf,
  buildManifest,
  describeSyxFile,
  groupDirectory,
  naturalCompare,
  packFs1rBank,
  slugifyPath,
  type DescribedFile,
  type SourceFile,
} from './patch-library-core.mts';
import { VOICE_BANK_ORDER } from '@texed/dx7-format/voice-library';
import type { LibBank, LibCollection, LibSet } from '@texed/dx7-format/library-manifest';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const PATCHES_DIR = path.resolve(scriptDir, '..', '..', 'patches');
const OUT_DIR = path.resolve(scriptDir, '..', 'public', 'library');

interface CollectionSpec {
  id: string;
  name: string;
  /** Directory under patches/. */
  dir: string;
  kind: 'raw' | 'syx';
  /**
   * Override for the grouping heuristic: rel path of a performance-only file
   * (forward slashes) → the voice bank files it uses, in slot order.
   */
  perfBankMap?: Record<string, string[]>;
}

const COLLECTIONS: CollectionSpec[] = [
  { id: 'fs1r', name: 'DX7 Voices from FS1R', dir: 'DX7 Voices from FS1R', kind: 'raw' },
  {
    id: 'tx802-factory',
    name: 'TX802 Factory',
    dir: 'TX802_Factory',
    kind: 'syx',
    perfBankMap: {
      'P.SYX': ['A1.SYX', 'A2.SYX', 'B1.SYX', 'B2.SYX'],
    },
  },
  { id: 'dexed', name: 'Dexed', dir: 'Dexed', kind: 'syx' },
  { id: 'tx802-collections', name: 'TX802 Collections', dir: 'TX802_Collections', kind: 'syx' },
  { id: 'dx7iifd-factory', name: 'DX7IIFD Factory', dir: 'DX7IIFD_Factory', kind: 'syx' },
  { id: 'dx7s-factory', name: 'DX7s Factory', dir: 'DX7s_Factory', kind: 'syx' },
  { id: 'dx5', name: 'DX5', dir: 'DX5', kind: 'syx' },
  { id: 'dx7ii-collections', name: 'DX7II Collections', dir: 'DX7II_Collections', kind: 'syx' },
  {
    id: 'dx7ii-freeware',
    name: 'DX7II Yamaha Freeware',
    dir: 'DX7II_Yamaha_Freeware',
    kind: 'syx',
  },
];

/** All files under `root`, as collection-relative forward-slash paths, sorted. */
async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).replaceAll(path.sep, '/'))
    .sort(naturalCompare);
}

async function writeOut(relPath: string, data: Uint8Array | string): Promise<void> {
  const abs = path.join(OUT_DIR, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

function fileStem(relPath: string): string {
  return relPath
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '');
}

function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}

/** "Bank 0" → "Bank C"; the numeric id and blob path stay as they are. */
function fs1rBankLabel(n: string): string {
  const idx = Number(n);
  return Number.isInteger(idx) && idx >= 0 && idx < 24
    ? `Bank ${String.fromCharCode(67 + idx)}`
    : `Bank ${n}`;
}

async function buildFs1rCollection(spec: CollectionSpec): Promise<LibCollection> {
  const root = path.join(PATCHES_DIR, spec.dir);
  const banks: LibBank[] = [];
  const sets: LibSet[] = [];
  const bankDirs = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(naturalCompare);

  for (const dirName of bankDirs) {
    const bankRoot = path.join(root, dirName);
    const voiceFiles = (await walkFiles(bankRoot)).filter((f) => /\.dx7voice$/i.test(f));
    if (voiceFiles.length === 0) continue;
    const files: SourceFile[] = await Promise.all(
      voiceFiles.map(async (f) => ({
        path: f,
        data: new Uint8Array(await readFile(path.join(bankRoot, f))),
      })),
    );
    const { blob, names } = packFs1rBank(files);
    const n = dirName.replace(/\D+/g, '') || dirName;
    const file = `${spec.id}/bank-${n}.vced.bin`;
    const id = `${spec.id}/bank-${n}`;
    const label = fs1rBankLabel(n);
    await writeOut(file, blob);
    banks.push({ id, name: label, file, format: 'vced155', voices: names });
    // These banks hold 128 voices, so loading the set fills every half-bank.
    sets.push({
      id: `${id}#set`,
      name: label,
      kind: 'voices',
      slots: VOICE_BANK_ORDER.filter((_, i) => i * 32 < names.length).map((slot, i) => ({
        slot,
        bankId: id,
        start: i * 32,
      })),
    });
  }
  return { id: spec.id, name: spec.name, banks, sets };
}

async function buildSyxCollection(spec: CollectionSpec): Promise<LibCollection> {
  const root = path.join(PATCHES_DIR, spec.dir);
  const banks: LibBank[] = [];

  // Describe every file first, then group each directory on its own.
  const byDir = new Map<string, DescribedFile[]>();
  const unsupportedByDir = new Map<string, string[]>();
  const patchFiles = (await walkFiles(root)).filter((f) => /\.(syx|mx)$/i.test(f));

  for (const rel of patchFiles) {
    const bytes = new Uint8Array(await readFile(path.join(root, rel)));
    const desc = describeSyxFile(bytes);
    const dir = dirOf(rel);
    if (!desc.supported || (desc.banks.length === 0 && desc.performanceNames.length === 0)) {
      unsupportedByDir.set(dir, [...(unsupportedByDir.get(dir) ?? []), rel]);
      continue;
    }
    const outFile = `${spec.id}/${slugifyPath(rel)}`;
    await writeOut(outFile, bytes);
    const stem = fileStem(rel);

    for (const b of desc.banks) {
      banks.push({
        id: bankIdOf(outFile, b.sourceBank),
        name: desc.banks.length > 1 ? `${stem} · ${b.label}` : stem,
        file: outFile,
        format: 'syx',
        sourceBank: b.sourceBank,
        ...(b.hasAmem ? { hasAmem: true, amemVoices: b.amemVoices } : {}),
        voices: b.voices,
      });
    }
    byDir.set(dir, [...(byDir.get(dir) ?? []), { rel, outFile, stem, desc }]);
  }

  const sets: LibSet[] = [];
  const dirs = [...new Set([...byDir.keys(), ...unsupportedByDir.keys()])].sort();
  for (const dir of dirs) {
    const label = dir ? `${spec.dir}/${dir}` : spec.dir;
    const { sets: dirSets, warnings } = groupDirectory(
      label,
      byDir.get(dir) ?? [],
      unsupportedByDir.get(dir) ?? [],
      spec.perfBankMap ?? {},
    );
    for (const w of warnings) console.warn(`  ${w}`);
    // Several collections repeat stems like "A" and "B" across subfolders, so
    // a set in a subfolder is named after it.
    const folder = dir.split('/').pop();
    if (folder) for (const s of dirSets) s.name = `${folder} · ${s.name}`;
    sets.push(...dirSets);
  }

  return { id: spec.id, name: spec.name, banks, sets };
}

async function main(): Promise<void> {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const collections: LibCollection[] = [];
  for (const spec of COLLECTIONS) {
    console.log(`collection: ${spec.name}`);
    const col =
      spec.kind === 'raw' ? await buildFs1rCollection(spec) : await buildSyxCollection(spec);
    if (col.banks.length === 0 && col.sets.length === 0) {
      console.warn(`  empty collection, dropped: ${spec.id}`);
      continue;
    }
    collections.push(col);
  }

  const manifest = buildManifest(collections);
  await writeOut('manifest.json', JSON.stringify(manifest));

  const banks = collections.flatMap((c) => c.banks);
  const sets = collections.flatMap((c) => c.sets);
  const nVoices = banks.reduce((n, b) => n + b.voices.length, 0);
  const nPerformances = sets.reduce((n, s) => n + (s.performances?.length ?? 0), 0);
  console.log(
    `library: ${collections.length} collections, ${sets.length} sets, ${banks.length} banks, ${nVoices} voices, ${nPerformances} performances`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
