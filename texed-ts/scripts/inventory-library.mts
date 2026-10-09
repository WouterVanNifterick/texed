// Inventory every SysEx (and raw VCED) file under public/library/.
// Lists each message's detected kind plus a short content summary.
//
//   pnpm inventory:library

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cartridgeFromSyx,
  identifySysex,
  isRawVcedBuffer,
  SysexKind,
  voiceFromRawVced,
  voiceFromVced,
  type SysexFrame,
} from '@texed/dx7-format/sysex';
import { performancesFromFrame } from '@texed/dx7-format/performance';
import { getVoiceName } from '@texed/dx7-format/voice';
import {
  masterTuningCents,
  parseSystemSetup,
  systemSetupPayloadFromFrame,
} from '@texed/dx7-format/system-setup';
import { naturalCompare } from './patch-library-core.mts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY_DIR = path.resolve(scriptDir, '..', 'public', 'library');
const OUT_MD = path.join(LIBRARY_DIR, 'inventory.md');
const OUT_JSON = path.join(LIBRARY_DIR, 'inventory.json');

const DATA_EXTS = new Set(['.syx', '.bin']);

interface MessageInfo {
  index: number;
  kind: string;
  channel: number;
  bytes: number;
  format?: number;
  formatId?: string;
  checksumOk?: boolean;
  summary: string;
  names?: string[];
}

interface FileInfo {
  path: string;
  collection: string;
  size: number;
  container: 'sysex' | 'rawVced' | 'empty' | 'unknown';
  messageCount: number;
  kindCounts: Record<string, number>;
  messages: MessageInfo[];
  notes: string[];
}

interface Inventory {
  generatedAt: string;
  libraryDir: string;
  fileCount: number;
  messageCount: number;
  kindTotals: Record<string, number>;
  files: FileInfo[];
}

function relPosix(from: string, to: string): string {
  return path.relative(from, to).replaceAll(path.sep, '/');
}

async function walkDataFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && DATA_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(e.parentPath, e.name))
    .sort(naturalCompare);
}

function bump(map: Record<string, number>, key: string, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

/** Kind counts, most frequent first, ties by name. */
function byCountDesc(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function formatHex(n: number | undefined): string {
  if (n === undefined) return '-';
  return `0x${n.toString(16).padStart(2, '0')}`;
}

/** Strip NULs / other controls so inventory markdown stays text-safe. */
function cleanName(name: string): string {
  return (
    name
      // Voice names come straight out of SysEx, so control bytes are exactly
      // what needs matching here.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trimEnd()
  );
}

function cleanNames(names: string[]): string[] {
  return names.map(cleanName);
}

function countNames(names: string[]): { total: number; nonEmpty: number } {
  const nonEmpty = names.filter((n) => n.trim().length > 0).length;
  return { total: names.length, nonEmpty };
}

function namesPreview(names: string[], limit = 8): string {
  const shown = names.slice(0, limit).map((n) => {
    const c = cleanName(n);
    return c.trim() ? c : '(empty)';
  });
  const more = names.length > limit ? `, ... (+${names.length - limit})` : '';
  return shown.join(', ') + more;
}

function describeParamChange(frame: SysexFrame): string {
  const raw = frame.raw;
  if (raw.length < 6) return 'parameter change (short)';
  const group = raw[3];
  const param = raw[4];
  const value = raw[5] & 0x7f;
  // DX7II bank-select tag used before VMEM/AMEM dumps.
  if (param === 0x4d) {
    return value === 1 ? 'bank tag → cartridgeA' : 'bank tag → internalA';
  }
  return `param group=${formatHex(group)} param=${formatHex(param)} value=${value}`;
}

function describeFrame(frame: SysexFrame, index: number): MessageInfo {
  const formatId = frame.formatId ? cleanName(frame.formatId) : undefined;
  const idSuffix = formatId ? ` (${formatId.trim()})` : '';
  const base: MessageInfo = {
    index,
    kind: frame.kind,
    channel: frame.channel,
    bytes: frame.raw.length,
    format: frame.format,
    formatId,
    checksumOk: frame.checksumOk,
    summary: '',
  };

  switch (frame.kind) {
    case SysexKind.Cartridge: {
      const cart = cartridgeFromSyx(frame.raw);
      if (!cart) {
        base.summary = 'VMEM 32-voice bank (parse failed)';
        return base;
      }
      const names = cleanNames(cart.programNames());
      const { nonEmpty, total } = countNames(names);
      base.names = names;
      base.summary = `VMEM ${total} voices (${nonEmpty} named): ${namesPreview(names)}`;
      return base;
    }
    case SysexKind.Voice: {
      const voice = voiceFromVced(frame.raw);
      const name = voice ? cleanName(getVoiceName(voice)) : '?';
      base.names = voice ? [name] : undefined;
      base.summary = `VCED single voice: ${name || '(empty)'}`;
      return base;
    }
    case SysexKind.Amem:
      base.summary = 'AMEM 32-voice supplement (format 0x06)';
      return base;
    case SysexKind.AcedBank:
      base.summary = `AMEM/ACED bank${idSuffix}`;
      return base;
    case SysexKind.Aced:
      base.summary = `ACED single voice edit${idSuffix}`;
      return base;
    case SysexKind.Dx7iiPerformance:
    case SysexKind.Dx7iiPerformanceEdit:
    case SysexKind.Performance: {
      const perfs = performancesFromFrame(frame);
      if (!perfs || perfs.length === 0) {
        base.summary =
          frame.kind === SysexKind.Performance
            ? 'TX802 performance (parse failed)'
            : 'DX7II performance (parse failed)';
        return base;
      }
      const names = cleanNames(perfs.map((p) => p.name));
      base.names = names;
      const label =
        frame.kind === SysexKind.Performance
          ? 'TX802 performance'
          : frame.kind === SysexKind.Dx7iiPerformanceEdit
            ? 'DX7II performance edit'
            : 'DX7II performance memory';
      const { nonEmpty, total } = countNames(names);
      base.summary = `${label}: ${total} slot(s), ${nonEmpty} named: ${namesPreview(names)}`;
      return base;
    }
    case SysexKind.Dx5Performance:
      base.summary = 'DX1/DX5 performance bulk (PMEM)';
      return base;
    case SysexKind.SystemSetup: {
      const data = systemSetupPayloadFromFrame(frame.raw);
      if (!data) {
        base.summary = 'system setup (parse failed)';
        return base;
      }
      const setup = parseSystemSetup(data);
      base.summary = `system setup: device=${setup.deviceNo} masterTune=${masterTuningCents(setup.masterTuning).toFixed(1)} cents protect=${setup.memoryProtect}`;
      return base;
    }
    case SysexKind.Microtune:
      base.summary = `microtuning${idSuffix}`;
      return base;
    case SysexKind.FractionalScale:
      base.summary = `fractional key scaling${idSuffix}`;
      return base;
    case SysexKind.ParamChange:
      base.summary = describeParamChange(frame);
      return base;
    case SysexKind.Unknown:
    default: {
      const bits = [
        `unknown Yamaha/other`,
        frame.format !== undefined ? `format=${formatHex(frame.format)}` : null,
        formatId ? `id="${formatId}"` : null,
      ].filter(Boolean);
      base.summary = bits.join(' ');
      return base;
    }
  }
}

function describeRawVced(bytes: Uint8Array): MessageInfo[] {
  if (bytes.length === 155 || bytes.length === 156) {
    const voice = voiceFromRawVced(bytes);
    const name = voice ? cleanName(getVoiceName(voice)) : '?';
    return [
      {
        index: 1,
        kind: 'rawVced',
        channel: 0,
        bytes: bytes.length,
        summary: `raw VCED single voice: ${name || '(empty)'}`,
        names: voice ? [name] : undefined,
      },
    ];
  }

  const names: string[] = [];
  for (let i = 0; i + 155 <= bytes.length; i += 155) {
    const voice = voiceFromRawVced(bytes.subarray(i, i + 155));
    names.push(voice ? cleanName(getVoiceName(voice)) : '?');
  }
  if (names.length === 0) return [];
  const { nonEmpty, total } = countNames(names);
  return [
    {
      index: 1,
      kind: 'rawVcedBank',
      channel: 0,
      bytes: bytes.length,
      summary: `raw VCED bank: ${total} voices (${nonEmpty} named): ${namesPreview(names)}`,
      names,
    },
  ];
}

function inventFile(relPath: string, bytes: Uint8Array): FileInfo {
  const frames = identifySysex(bytes);
  const notes: string[] = [];
  let container: FileInfo['container'];
  let messages: MessageInfo[] = [];

  if (frames.length > 0) {
    container = 'sysex';
    messages = frames.map((f, i) => describeFrame(f, i + 1));
    const covered = frames.reduce((n, f) => n + f.raw.length, 0);
    if (covered < bytes.length) {
      notes.push(`${bytes.length - covered} non-SysEx byte(s) outside F0..F7 frames`);
    }
  } else if (isRawVcedBuffer(bytes)) {
    container = 'rawVced';
    messages = describeRawVced(bytes);
  } else if (bytes.length === 0) {
    container = 'empty';
    notes.push('empty file');
  } else {
    container = 'unknown';
    notes.push('no SysEx frames and not raw VCED');
  }

  const kindCounts: Record<string, number> = {};
  for (const m of messages) bump(kindCounts, m.kind);

  return {
    path: relPath,
    collection: relPath.split('/')[0] ?? relPath,
    size: bytes.length,
    container,
    messageCount: messages.length,
    kindCounts,
    messages,
    notes,
  };
}

function renderMarkdown(inv: Inventory): string {
  const lines: string[] = [];
  lines.push('# Library SysEx inventory');
  lines.push('');
  lines.push(`Generated: ${inv.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Files: **${inv.fileCount}**`);
  lines.push(`- SysEx / raw messages: **${inv.messageCount}**`);
  lines.push('- Message kinds:');
  for (const [kind, n] of byCountDesc(inv.kindTotals)) {
    lines.push(`  - \`${kind}\`: ${n}`);
  }
  lines.push('');

  const byCollection = new Map<string, FileInfo[]>();
  for (const f of inv.files) {
    const list = byCollection.get(f.collection) ?? [];
    list.push(f);
    byCollection.set(f.collection, list);
  }

  lines.push('## Collections');
  lines.push('');
  for (const [collection, files] of byCollection) {
    const msgs = files.reduce((s, f) => s + f.messageCount, 0);
    const kinds = new Set(files.flatMap((f) => Object.keys(f.kindCounts)));
    lines.push(
      `- **${collection}**: ${files.length} file(s), ${msgs} message(s); kinds: ${[...kinds].sort().join(', ') || '(none)'}`,
    );
  }
  lines.push('');

  lines.push('## Files');
  lines.push('');

  for (const [collection, files] of byCollection) {
    lines.push(`### ${collection}`);
    lines.push('');
    for (const f of files) {
      const kindList = byCountDesc(f.kindCounts)
        .map(([k, n]) => `${n}× ${k}`)
        .join(', ');
      lines.push(`#### \`${f.path}\``);
      lines.push('');
      lines.push(
        `- Size: ${f.size} bytes | container: \`${f.container}\` | messages: **${f.messageCount}**${kindList ? ` (${kindList})` : ''}`,
      );
      for (const n of f.notes) lines.push(`- Note: ${n}`);
      lines.push('');
      if (f.messages.length === 0) {
        lines.push('_No messages detected._');
        lines.push('');
        continue;
      }
      lines.push('| # | Kind | Bytes | Info |');
      lines.push('| ---: | --- | ---: | --- |');
      for (const m of f.messages) {
        const ck = m.checksumOk === undefined ? '-' : m.checksumOk ? 'ok' : 'BAD';
        let info = m.summary.replace(/\|/g, '\\|');
        if (ck === 'BAD') info += ' ⚠️';

        lines.push(`| ${m.index} | \`${m.kind}\` | ${m.bytes} | ${ck} | ${info} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const absFiles = await walkDataFiles(LIBRARY_DIR);
  const files: FileInfo[] = [];
  const kindTotals: Record<string, number> = {};

  for (const abs of absFiles) {
    const rel = relPosix(LIBRARY_DIR, abs);
    const bytes = new Uint8Array(await readFile(abs));
    const info = inventFile(rel, bytes);
    files.push(info);
    for (const [k, n] of Object.entries(info.kindCounts)) bump(kindTotals, k, n);
  }

  const messageCount = files.reduce((s, f) => s + f.messageCount, 0);
  const inv: Inventory = {
    generatedAt: new Date().toISOString(),
    libraryDir: relPosix(scriptDir, LIBRARY_DIR),
    fileCount: files.length,
    messageCount,
    kindTotals,
    files,
  };

  const md = renderMarkdown(inv);
  await writeFile(OUT_MD, md);
  await writeFile(OUT_JSON, JSON.stringify(inv, null, 2) + '\n');

  console.log(`Inventoried ${inv.fileCount} files / ${inv.messageCount} messages`);
  console.log('Kind totals:');
  for (const [kind, n] of byCountDesc(kindTotals)) {
    console.log(`  ${kind.padEnd(24)} ${n}`);
  }
  console.log('');
  console.log(`Wrote ${relPosix(process.cwd(), OUT_MD)}`);
  console.log(`Wrote ${relPosix(process.cwd(), OUT_JSON)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
