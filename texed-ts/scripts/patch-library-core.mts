// Pure helpers for the built-in patch library build (no filesystem access).
// Reuses the engine's sysex parsers so the manifest always agrees with what
// the app will load at runtime.

import { loadSysexFile } from '@texed/dx7-format/sysex-loader';
import { createDefaultAmem } from '@texed/dx7-format/amem';
import { VOICE_BANK_LABELS, type VoiceBankId } from '@texed/dx7-format/voice-library';
import {
  LIBRARY_SCHEMA,
  type LibCollection,
  type LibraryManifest,
} from '../src/state/library-manifest';

export interface SourceFile {
  /** Path relative to the collection root, forward slashes. */
  path: string;
  data: Uint8Array;
}

const VCED_SIZE = 155;

/** "0.003 MM-Piano 1.Dx7Voice" → "MM-Piano 1". */
export function fs1rVoiceNameFromFilename(filename: string): string {
  const base = filename.split('/').pop()!.replace(/\.dx7voice$/i, '');
  const m = /^\d+\.\d+\s+(.+)$/.exec(base);
  return (m ? m[1] : base).trim();
}

export interface PackedFs1rBank {
  /** Concatenated raw 155-byte VCED voices, file order. */
  blob: Uint8Array;
  names: string[];
}

/** Pack a folder of FS1R .Dx7Voice exports (155/156-byte raw VCED) into one blob. */
export function packFs1rBank(files: SourceFile[]): PackedFs1rBank {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
  const names: string[] = [];
  const blob = new Uint8Array(sorted.length * VCED_SIZE);
  sorted.forEach((f, i) => {
    if (f.data.length !== 155 && f.data.length !== 156) {
      throw new Error(`${f.path}: unexpected raw VCED size ${f.data.length}`);
    }
    blob.set(f.data.subarray(0, VCED_SIZE), i * VCED_SIZE);
    names.push(fs1rVoiceNameFromFilename(f.path));
  });
  return { blob, names };
}

export interface SyxBankInfo {
  sourceBank: VoiceBankId;
  label: string;
  hasAmem: boolean;
  voices: string[];
}

export interface SyxDescription {
  banks: SyxBankInfo[];
  performanceNames: string[];
  /** True when the file carries both performances and the voice banks they use. */
  selfContained: boolean;
}

/** Parse a .syx with the engine loader and describe what the app would get. */
export function describeSyxFile(bytes: Uint8Array): SyxDescription {
  const { library, loaded } = loadSysexFile(bytes);
  if (!loaded) return { banks: [], performanceNames: [], selfContained: false };
  const defaultAmem = createDefaultAmem();
  const bankHasAmem = (b: VoiceBankId): boolean => {
    for (let p = 0; p < 32; p++) {
      const slot = library.resolve({ bank: b, program: p });
      if (slot && !slot.amem.every((v, i) => v === defaultAmem[i])) return true;
    }
    return false;
  };
  const banks = library.populatedBanks().map((b) => ({
    sourceBank: b,
    label: VOICE_BANK_LABELS[b],
    hasAmem: bankHasAmem(b),
    voices: library.programNames(b),
  }));
  const performanceNames = library.performances.map((p) => p.name);
  return { banks, performanceNames, selfContained: performanceNames.length > 0 && banks.length > 0 };
}

/** Path segment → URL-safe slug (keeps dots for extensions). */
export function slugifySegment(segment: string): string {
  return segment
    .replace(/[^A-Za-z0-9.+_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** Relative path → URL-safe manifest path (per-segment slugs, forward slashes). */
export function slugifyPath(relPath: string): string {
  return relPath.split('/').map(slugifySegment).join('/');
}

/** Assemble and validate the manifest; throws on structural problems. */
export function buildManifest(collections: LibCollection[]): LibraryManifest {
  if (collections.length === 0) throw new Error('manifest has no collections');
  const ids = new Set<string>();
  let totalVoices = 0;
  for (const c of collections) {
    if (ids.has(c.id)) throw new Error(`duplicate collection id ${c.id}`);
    ids.add(c.id);
    const bankIds = new Set<string>();
    for (const b of c.banks) {
      if (bankIds.has(b.id)) throw new Error(`duplicate bank id ${b.id}`);
      bankIds.add(b.id);
      if (b.voices.length === 0) throw new Error(`bank ${b.id} has no voices`);
      totalVoices += b.voices.length;
    }
    for (const p of c.performanceSets) {
      if (p.names.length === 0) throw new Error(`performance set ${p.id} has no performances`);
    }
  }
  if (totalVoices === 0) throw new Error('manifest has no voices');
  return { schema: LIBRARY_SCHEMA, collections };
}
