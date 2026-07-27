// Shared types for the built-in patch library manifest.
//
// The manifest is generated at build time by scripts/build-patch-library.mts
// into public/library/manifest.json and fetched by the app at runtime. Both
// sides import these types so the schema cannot drift.

import type { VoiceBankId } from './voice-library';

export const LIBRARY_SCHEMA = 2;

/** How a bank's blob file is encoded. */
export const LibBankFormat = {
  /** Concatenated raw 155-byte VCED voices (FS1R exports). */
  Vced155: 'vced155',
  /** A verbatim .syx file; parse with loadSysexFile and resolve via sourceBank. */
  Syx: 'syx',
} as const;
export type LibBankFormat = (typeof LibBankFormat)[keyof typeof LibBankFormat];

export interface LibBank {
  /** Unique within the manifest, e.g. "fs1r/bank-0" or "tx802-factory/a1.syx#internalA". */
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
  /** Voice indices whose AMEM differs from the default, when hasAmem. */
  amemVoices?: number[];
  /** Display names, one per voice (32 for syx half-banks, 128 for FS1R). */
  voices: string[];
}

/**
 * Data riding along in a set's files that is neither voices nor performances.
 * Recorded so the browser can say what a load drags in; loading behaviour is
 * unchanged (microtunings stored, system setup applied, the rest skipped).
 */
export interface LibExtras {
  microtunings?: number;
  systemSetup?: boolean;
  fractionalScale?: number;
}

/** One half-bank slot of the rack, and the bank a set loads into it. */
export interface LibSlot {
  slot: VoiceBankId;
  bankId: string;
  /** First voice of the bank to copy; only 128-voice banks span several slots. */
  start?: number;
}

/**
 * A group of files that belong together: a performance bank plus the voice
 * banks its parts reference, or a standalone voice bank nothing refers to.
 */
export interface LibSet {
  /** Unique within the manifest. */
  id: string;
  name: string;
  kind: 'performance' | 'voices';
  /** Path relative to public/library/ of the syx carrying the performances. */
  perfFile?: string;
  /** Performance display names in bank order. */
  performances?: string[];
  /** Which bank goes into which half-bank slot when the set is loaded. */
  slots: LibSlot[];
  /** Half-banks the performances reference that no bank in the set fills. */
  unresolvedSlots?: VoiceBankId[];
  extras?: LibExtras;
  /** Files grouped here that the sysex loader cannot read. */
  unsupported?: string[];
}

export interface LibCollection {
  id: string;
  name: string;
  /** Every bank in the collection, addressed by id from `sets`. */
  banks: LibBank[];
  sets: LibSet[];
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
