// Shared types for the built-in patch library manifest.
//
// The manifest is generated at build time by scripts/build-patch-library.mts
// into public/library/manifest.json and fetched by the app at runtime. Both
// sides import these types so the schema cannot drift.

import type { VoiceBankId } from '@texed/dx7-format/voice-library';

export const LIBRARY_SCHEMA = 1;

/** How a bank's blob file is encoded. */
export const LibBankFormat = {
  /** Concatenated raw 155-byte VCED voices (FS1R exports). */
  Vced155: 'vced155',
  /** A verbatim .syx file; parse with loadSysexFile and resolve via sourceBank. */
  Syx: 'syx',
} as const;
export type LibBankFormat = (typeof LibBankFormat)[keyof typeof LibBankFormat];

export interface LibBank {
  /** Unique within the manifest, e.g. "fs1r/bank-0" or "tx802-factory/a1". */
  id: string;
  name: string;
  /** Path relative to public/library/ (also the blob cache key). */
  file: string;
  format: LibBankFormat;
  /**
   * For syx banks: which VoiceLibrary half-bank this bank's voices land in
   * when the file is parsed standalone. A multi-bank syx yields one LibBank
   * per populated half-bank, all pointing at the same file.
   */
  sourceBank?: VoiceBankId;
  /**
   * True when the bank carries DX7II AMEM supplements (per-voice extras:
   * fractional scaling, unison, extended controllers). vced155 banks are
   * plain DX7 voices and never set this.
   */
  hasAmem?: boolean;
  /** Display names, one per voice (32 for syx half-banks, 128 for FS1R). */
  voices: string[];
}

export interface LibPerfSet {
  /** Unique within the manifest. */
  id: string;
  name: string;
  /** Path relative to public/library/ of the syx carrying the performances. */
  file: string;
  /** Performance display names in bank order. */
  names: string[];
  /**
   * Bank blob files (manifest-relative) that must be loaded into the four
   * half-banks (internalA..cartridgeB order) before these performances
   * resolve their voice references. Empty when the file is self-contained.
   */
  requiresBankFiles: string[];
}

export interface LibCollection {
  id: string;
  name: string;
  banks: LibBank[];
  performanceSets: LibPerfSet[];
}

export interface LibraryManifest {
  schema: typeof LIBRARY_SCHEMA;
  collections: LibCollection[];
}

/** Runtime guard for a fetched manifest of unknown provenance/version. */
export function isLibraryManifest(x: unknown): x is LibraryManifest {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Partial<LibraryManifest>;
  return m.schema === LIBRARY_SCHEMA && Array.isArray(m.collections);
}
