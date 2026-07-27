// Pure helpers for the built-in patch library build (no filesystem access).
// Reuses the engine's sysex parsers so the manifest always agrees with what
// the app will load at runtime.

import { loadSysexFile } from '@texed/dx7-format/sysex-loader';
import { identifySysex, SysexKind } from '@texed/dx7-format/sysex';
import { createDefaultAmem } from '@texed/dx7-format/amem';
import {
  VOICE_BANK_LABELS,
  VOICE_BANK_ORDER,
  type VoiceBankId,
} from '@texed/dx7-format/voice-library';
import {
  LIBRARY_SCHEMA,
  type LibCollection,
  type LibExtras,
  type LibraryManifest,
  type LibSet,
  type LibSlot,
} from '@texed/dx7-format/library-manifest';

export interface SourceFile {
  /** Path relative to the collection root, forward slashes. */
  path: string;
  data: Uint8Array;
}

const VCED_SIZE = 155;

/** "0.003 MM-Piano 1.Dx7Voice" → "MM-Piano 1". */
export function fs1rVoiceNameFromFilename(filename: string): string {
  const base = filename
    .split('/')
    .pop()!
    .replace(/\.dx7voice$/i, '');
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
  /** Voice indices whose AMEM differs from the default. */
  amemVoices: number[];
  voices: string[];
}

export interface SyxDescription {
  banks: SyxBankInfo[];
  performanceNames: string[];
  /** Half-banks the performances point at, in VOICE_BANK_ORDER. */
  refs: VoiceBankId[];
  /** True when the file carries both performances and the voice banks they use. */
  selfContained: boolean;
  extras: LibExtras;
  /** False when the loader recognized nothing at all. */
  supported: boolean;
}

/** Parse a .syx with the engine loader and describe what the app would get. */
export function describeSyxFile(bytes: Uint8Array): SyxDescription {
  const empty: SyxDescription = {
    banks: [],
    performanceNames: [],
    refs: [],
    selfContained: false,
    extras: {},
    supported: false,
  };
  const { library, loaded } = loadSysexFile(bytes);
  if (!loaded) return empty;

  const defaultAmem = createDefaultAmem();
  const amemVoicesOf = (b: VoiceBankId): number[] => {
    const out: number[] = [];
    for (let p = 0; p < 32; p++) {
      const slot = library.resolve({ bank: b, program: p });
      if (slot && !slot.amem.every((v, i) => v === defaultAmem[i])) out.push(p);
    }
    return out;
  };
  const banks = library.populatedBanks().map((b) => {
    const amemVoices = amemVoicesOf(b);
    return {
      sourceBank: b,
      label: VOICE_BANK_LABELS[b],
      hasAmem: amemVoices.length > 0,
      amemVoices,
      voices: library.programNames(b),
    };
  });

  const used = new Set<VoiceBankId>();
  for (const perf of library.performances) {
    for (const part of perf.parts) {
      if (part.enabled === false || !part.voice) continue;
      used.add(part.voice.bank);
    }
  }
  const refs = VOICE_BANK_ORDER.filter((b) => used.has(b));
  const performanceNames = library.performances.map((p) => p.name);

  const extras: LibExtras = {};
  let fractionalScale = 0;
  for (const frame of identifySysex(bytes)) {
    if (frame.kind === SysexKind.FractionalScale) fractionalScale++;
  }
  if (library.microtunings.length > 0) extras.microtunings = library.microtunings.length;
  if (library.systemSetup) extras.systemSetup = true;
  if (fractionalScale > 0) extras.fractionalScale = fractionalScale;

  return {
    banks,
    performanceNames,
    refs,
    selfContained:
      performanceNames.length > 0 && refs.every((r) => banks.some((b) => b.sourceBank === r)),
    extras,
    supported: true,
  };
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

// ==== grouping ====

/** One described source file, ready to be grouped with its neighbours. */
export interface DescribedFile {
  /** Collection-relative path, forward slashes. */
  rel: string;
  /** Manifest-relative path of the copied blob. */
  outFile: string;
  /** Filename without directory or extension. */
  stem: string;
  desc: SyxDescription;
}

/** Bank id for one populated half-bank of a copied file. */
export function bankIdOf(outFile: string, sourceBank: VoiceBankId): string {
  return `${outFile}#${sourceBank}`;
}

const PERF_TOKEN = /(^|[\s_.-])(perfs?|performances?|p)([\s_.-]|$)/i;

/** Strip a "perf" word from a stem so it can be matched against a voice file. */
function perfStemKey(stem: string): string | null {
  if (!PERF_TOKEN.test(stem)) return null;
  return stem
    .replace(PERF_TOKEN, '$1$3')
    .replace(/[\s_.-]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Loose "same family" test: one stem key is a prefix of the other. */
function stemsRelated(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function voiceStemKey(stem: string): string {
  return stem
    .replace(/(^|[\s_.-])(voices?|banks?|all|internal|cartridge|int|crt)([\s_.-]|$)/gi, '$1$3')
    .replace(/[\s_.-]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Pick the voice files that belong with an orphan performance bank: an
 * explicit override, else files whose stem looks like the same family, else -
 * when the directory is small enough to be unambiguous - everything in it.
 */
export function partnersForPerfBank(
  perf: DescribedFile,
  bankFiles: DescribedFile[],
  override?: string[],
): DescribedFile[] {
  if (override) {
    const byRel = new Map(bankFiles.map((f) => [f.rel, f]));
    return override.map((rel) => byRel.get(rel)).filter((f): f is DescribedFile => f !== undefined);
  }
  const key = perfStemKey(perf.stem);
  if (key) {
    const related = bankFiles.filter((f) => stemsRelated(voiceStemKey(f.stem), key));
    if (related.length > 0) return related.slice(0, VOICE_BANK_ORDER.length);
  }
  if (bankFiles.length > 0 && bankFiles.length <= VOICE_BANK_ORDER.length) return bankFiles;
  return [];
}

/**
 * Wire banks into the four half-bank slots. Each bank keeps its own
 * `sourceBank` when that slot is free, so a file that already knows it holds
 * CRT 33-64 lands there; the rest fill the slots the performances reference,
 * then any remaining slot in order.
 */
export function assignSlots(files: DescribedFile[], refs: VoiceBankId[]): LibSlot[] {
  const taken = new Map<VoiceBankId, string>();
  const pending: { file: DescribedFile; bank: SyxBankInfo }[] = [];

  for (const file of files) {
    for (const bank of file.desc.banks) {
      if (!taken.has(bank.sourceBank))
        taken.set(bank.sourceBank, bankIdOf(file.outFile, bank.sourceBank));
      else pending.push({ file, bank });
    }
  }
  const fallback = [...refs, ...VOICE_BANK_ORDER.filter((b) => !refs.includes(b))];
  for (const { file, bank } of pending) {
    const slot = fallback.find((s) => !taken.has(s));
    if (!slot) break;
    taken.set(slot, bankIdOf(file.outFile, bank.sourceBank));
  }
  return VOICE_BANK_ORDER.filter((s) => taken.has(s)).map((slot) => ({
    slot,
    bankId: taken.get(slot)!,
  }));
}

function mergeExtras(files: DescribedFile[]): LibExtras | undefined {
  const out: LibExtras = {};
  for (const f of files) {
    if (f.desc.extras.microtunings)
      out.microtunings = (out.microtunings ?? 0) + f.desc.extras.microtunings;
    if (f.desc.extras.systemSetup) out.systemSetup = true;
    if (f.desc.extras.fractionalScale)
      out.fractionalScale = (out.fractionalScale ?? 0) + f.desc.extras.fractionalScale;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface GroupResult {
  sets: LibSet[];
  warnings: string[];
}

/**
 * Group one directory's files into sets. A file carrying both performances and
 * the banks they reference stands alone; a performance bank with no banks of
 * its own adopts the voice files beside it; whatever is left becomes a
 * voice-only set per file.
 */
export function groupDirectory(
  dirLabel: string,
  files: DescribedFile[],
  unsupported: string[],
  overrides: Record<string, string[]> = {},
): GroupResult {
  const warnings: string[] = [];
  const sets: LibSet[] = [];

  const perfFiles = files.filter((f) => f.desc.performanceNames.length > 0);
  const bankOnly = files.filter(
    (f) => f.desc.performanceNames.length === 0 && f.desc.banks.length > 0,
  );
  const consumed = new Set<DescribedFile>();

  // Any bank in this directory that plainly states which half-bank it holds.
  // Used to complete a set whose performances reach into a bank another file
  // in the same folder carries - a DX7II factory cartridge referencing the
  // internal memory saved beside it, for instance.
  const byExactSlot = new Map<VoiceBankId, string>();
  for (const file of files) {
    for (const bank of file.desc.banks) {
      if (!byExactSlot.has(bank.sourceBank))
        byExactSlot.set(bank.sourceBank, bankIdOf(file.outFile, bank.sourceBank));
    }
  }

  const makeSet = (perf: DescribedFile, members: DescribedFile[]): LibSet => {
    const slots = assignSlots(members, perf.desc.refs);
    const filled = new Set(slots.map((s) => s.slot));
    for (const ref of perf.desc.refs) {
      const bankId = filled.has(ref) ? undefined : byExactSlot.get(ref);
      if (!bankId) continue;
      slots.push({ slot: ref, bankId });
      filled.add(ref);
    }
    slots.sort((a, b) => VOICE_BANK_ORDER.indexOf(a.slot) - VOICE_BANK_ORDER.indexOf(b.slot));
    const unresolvedSlots = perf.desc.refs.filter((r) => !filled.has(r));
    const set: LibSet = {
      id: `${perf.outFile}#set`,
      name: perf.stem,
      kind: 'performance',
      perfFile: perf.outFile,
      performances: perf.desc.performanceNames,
      slots,
    };
    if (unresolvedSlots.length > 0) set.unresolvedSlots = unresolvedSlots;
    const extras = mergeExtras(members);
    if (extras) set.extras = extras;
    return set;
  };

  for (const perf of perfFiles) {
    if (perf.desc.selfContained) {
      sets.push(makeSet(perf, [perf]));
      continue;
    }
    const available = bankOnly.filter((f) => !consumed.has(f));
    const partners = partnersForPerfBank(perf, available, overrides[perf.rel]);
    // A file with banks of its own leads; adopted voice files fill the gaps.
    const members = perf.desc.banks.length > 0 ? [perf, ...partners] : partners;
    partners.forEach((p) => consumed.add(p));
    const set = makeSet(perf, members);
    if (set.unresolvedSlots) {
      warnings.push(
        `${dirLabel}: ${perf.stem} references ${set.unresolvedSlots.join(', ')} with nothing to fill it`,
      );
    }
    sets.push(set);
  }

  for (const file of bankOnly) {
    if (consumed.has(file)) continue;
    sets.push({
      id: `${file.outFile}#set`,
      name: file.stem,
      kind: 'voices',
      slots: assignSlots([file], []),
      ...(mergeExtras([file]) ? { extras: mergeExtras([file]) } : {}),
    });
  }

  if (unsupported.length > 0) {
    for (const rel of unsupported) {
      warnings.push(`${dirLabel}: ${rel} is nothing the loader recognizes`);
    }
    // Hang them off the directory's performance set when there is exactly one
    // obvious home; otherwise they get an entry of their own rather than
    // attaching to an unrelated bank.
    const perfSets = sets.filter((s) => s.kind === 'performance');
    if (perfSets.length === 1) perfSets[0].unsupported = unsupported;
    else {
      sets.push({
        id: `${dirLabel}#unsupported`,
        name: `${dirLabel.split('/').pop() ?? dirLabel} · unreadable`,
        kind: 'voices',
        slots: [],
        unsupported,
      });
    }
  }

  return { sets, warnings };
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
    const setIds = new Set<string>();
    for (const s of c.sets) {
      if (setIds.has(s.id)) throw new Error(`duplicate set id ${s.id}`);
      setIds.add(s.id);
      if (s.kind === 'performance' && (s.performances?.length ?? 0) === 0) {
        throw new Error(`performance set ${s.id} has no performances`);
      }
      for (const slot of s.slots) {
        if (!bankIds.has(slot.bankId))
          throw new Error(`set ${s.id} wires unknown bank ${slot.bankId}`);
      }
    }
  }
  if (totalVoices === 0) throw new Error('manifest has no voices');
  return { schema: LIBRARY_SCHEMA, collections };
}
