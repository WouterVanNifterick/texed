// MiniDexed performance.ini parse/serialize (8 tone generators).
// Maps core routing + VoiceData into PartConfig; other keys round-trip opaquely.

import type { PartConfig } from './part-config';
import { NUM_PARTS } from './part-config';
import { DEFAULT_REVERB_SETTINGS, type GlobalSettings } from './global-settings';
import { voiceFromRawVced } from './sysex';

const TG_SUFFIX = /^(.+?)(\d+)$/;

/** Keys written from Texed part state (not taken from extras on save). */
const MAPPED_TG_KEYS = new Set([
  'MIDIChannel',
  'Volume',
  'Pan',
  'Detune',
  'NoteLimitLow',
  'NoteLimitHigh',
  'NoteShift',
  'Cutoff',
  'Resonance',
  'ReverbSend',
  'VoiceData',
]);

/** Per-TG keys preserved when not mapped from UI. */
const PRESERVED_TG_KEYS = [
  'BankNumber',
  'VoiceNumber',
  'PitchBendRange',
  'PitchBendStep',
  'PortamentoMode',
  'PortamentoGlissando',
  'PortamentoTime',
  'MonoMode',
  'ModulationWheelRange',
  'ModulationWheelTarget',
  'FootControlRange',
  'FootControlTarget',
  'BreathControlRange',
  'BreathControlTarget',
  'AftertouchRange',
  'AftertouchTarget',
] as const;

/** Global keys mapped onto GlobalSettings, with MiniDexed's own defaults. */
const GLOBAL_KEY_DEFAULTS = {
  CompressorEnable: 1,
  ReverbEnable: 1,
  ReverbSize: 70,
  ReverbHighDamp: 50,
  ReverbLowDamp: 50,
  ReverbLowPass: 30,
  ReverbDiffusion: 65,
  ReverbLevel: 99,
} as const;

type GlobalKey = keyof typeof GLOBAL_KEY_DEFAULTS;

export type MiniDexedTgExtras = Partial<Record<(typeof PRESERVED_TG_KEYS)[number], string>>;

export interface MiniDexedExtras {
  /** Preamble comment/blank lines from the source file. */
  preamble: string[];
  /** TG index 0..7 */
  tg: MiniDexedTgExtras[];
  /** Unknown keys in file order (full Key=Value lines). */
  unknown: { key: string; value: string }[];
}

/** The compressor switch and reverb block a performance carries. */
export type MiniDexedGlobals = Pick<GlobalSettings, 'compressor' | 'reverb'>;

export interface ParsedMiniDexedIni {
  /** Value of the top-level `Name=` key, if present. */
  name: string | null;
  parts: Partial<PartConfig>[];
  voices: (Uint8Array | null)[];
  global: MiniDexedGlobals;
  extras: MiniDexedExtras;
}

export interface SerializeMiniDexedIniInput {
  /** Written as the top-level `Name=` key when non-empty. */
  name?: string | null;
  parts: PartConfig[];
  voices: Uint8Array[];
  global: MiniDexedGlobals;
  extras?: MiniDexedExtras | null;
}

function emptyExtras(): MiniDexedExtras {
  return {
    preamble: [],
    tg: Array.from({ length: NUM_PARTS }, () => ({})),
    unknown: [],
  };
}

const DEFAULT_TG_EXTRAS: MiniDexedTgExtras = {
  BankNumber: '0',
  VoiceNumber: '1',
  PitchBendRange: '2',
  PitchBendStep: '0',
  PortamentoMode: '0',
  PortamentoGlissando: '0',
  PortamentoTime: '0',
  MonoMode: '0',
  ModulationWheelRange: '99',
  ModulationWheelTarget: '1',
  FootControlRange: '99',
  FootControlTarget: '0',
  BreathControlRange: '99',
  BreathControlTarget: '0',
  AftertouchRange: '99',
  AftertouchTarget: '0',
};

function parseIntValue(raw: string, fallback: number): number {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** MiniDexed's controls run 0..99; ours are normalised. */
function fromCc99(raw: number): number {
  return Math.max(0, Math.min(1, raw / 99));
}

function toCc99(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 99);
}

function mapMidiChannel(raw: number): Pick<PartConfig, 'enabled' | 'rxChannel'> {
  if (raw === 0) return { enabled: false, rxChannel: 1 };
  if (raw >= 1 && raw <= 16) return { enabled: true, rxChannel: raw };
  return { enabled: true, rxChannel: 0 };
}

function unmapMidiChannel(cfg: PartConfig): number {
  if (!cfg.enabled) return 0;
  if (cfg.rxChannel === 0) return 255;
  return cfg.rxChannel;
}

/**
 * MiniDexed's own mixer feeds `sin()` (which is 0 at Pan=0) to the left sum and
 * `cos()` to the right, so on real hardware Pan=0 is hard right. That
 * contradicts MIDI CC 10, where 0 is hard left, and it applies to their CC 10
 * handling too, so it is a bug rather than a convention. Imports follow the
 * MIDI meaning; a MiniDexed performance therefore comes in mirrored, which for
 * their shipped files (Pan1=0 / Pan2=127) only swaps a symmetric spread.
 */
function mapPan(raw: number): number {
  return (raw - 64) / 64;
}

function unmapPan(pan: number): number {
  return Math.round(Math.max(-1, Math.min(1, pan)) * 64 + 64);
}

export function decodeVoiceDataHex(text: string): Uint8Array | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/\s+/);
  const bytes = new Uint8Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.length !== 2) return null;
    const hi = parseHexNibble(t.charCodeAt(0));
    const lo = parseHexNibble(t.charCodeAt(1));
    if (hi < 0 || lo < 0) return null;
    bytes[i] = (hi << 4) | lo;
  }
  return voiceFromRawVced(bytes);
}

function parseHexNibble(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x37;
  if (code >= 0x61 && code <= 0x66) return code - 0x57;
  return -1;
}

export function encodeVoiceDataHex(voice: Uint8Array): string {
  const n = Math.min(156, voice.length);
  const hex = '0123456789ABCDEF';
  let out = '';
  for (let i = 0; i < n; i++) {
    const b = voice[i]! & 0xff;
    if (i > 0) out += ' ';
    out += hex[(b >> 4) & 0x0f]! + hex[b & 0x0f]!;
  }
  return out;
}

function isPreservedTgKey(base: string): base is (typeof PRESERVED_TG_KEYS)[number] {
  return (PRESERVED_TG_KEYS as readonly string[]).includes(base);
}

function isGlobalKey(key: string): key is GlobalKey {
  return key in GLOBAL_KEY_DEFAULTS;
}

export function parseMiniDexedIni(text: string): ParsedMiniDexedIni {
  const extras = emptyExtras();
  const parts: Partial<PartConfig>[] = Array.from({ length: NUM_PARTS }, () => ({}));
  const voices: (Uint8Array | null)[] = Array.from({ length: NUM_PARTS }, () => null);
  const globalRaw: Partial<Record<GlobalKey, number>> = {};
  let name: string | null = null;

  const tgRaw: {
    midi?: number;
    volume?: number;
    pan?: number;
    detune?: number;
    noteLow?: number;
    noteHigh?: number;
    noteShift?: number;
    cutoff?: number;
    resonance?: number;
    reverbSend?: number;
    voiceData?: string;
  }[] = Array.from({ length: NUM_PARTS }, () => ({}));

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) {
      extras.preamble.push(trimmed);
      continue;
    }
    const commentIdx = trimmed.indexOf('#');
    const body = commentIdx >= 0 ? trimmed.slice(0, commentIdx).trim() : trimmed.trim();
    if (commentIdx >= 0 && !body) {
      extras.preamble.push(trimmed);
      continue;
    }
    if (!body) continue;

    const eq = body.indexOf('=');
    if (eq < 0) {
      extras.preamble.push(trimmed);
      continue;
    }
    const key = body.slice(0, eq).trim();
    const value = body.slice(eq + 1).trim();

    const m = TG_SUFFIX.exec(key);
    if (m) {
      const base = m[1]!;
      const tg = Number.parseInt(m[2]!, 10) - 1;
      if (tg < 0 || tg >= NUM_PARTS) {
        extras.unknown.push({ key, value });
        continue;
      }
      if (MAPPED_TG_KEYS.has(base)) {
        const slot = tgRaw[tg]!;
        switch (base) {
          case 'MIDIChannel':
            slot.midi = parseIntValue(value, 0);
            break;
          case 'Volume':
            slot.volume = parseIntValue(value, 100);
            break;
          case 'Pan':
            slot.pan = parseIntValue(value, 64);
            break;
          case 'Detune':
            slot.detune = parseIntValue(value, 0);
            break;
          case 'NoteLimitLow':
            slot.noteLow = parseIntValue(value, 0);
            break;
          case 'NoteLimitHigh':
            slot.noteHigh = parseIntValue(value, 127);
            break;
          case 'NoteShift':
            slot.noteShift = parseIntValue(value, 0);
            break;
          case 'Cutoff':
            slot.cutoff = parseIntValue(value, 99);
            break;
          case 'Resonance':
            slot.resonance = parseIntValue(value, 0);
            break;
          case 'ReverbSend':
            slot.reverbSend = parseIntValue(value, 50);
            break;
          case 'VoiceData':
            slot.voiceData = value;
            break;
        }
      } else if (isPreservedTgKey(base)) {
        extras.tg[tg]![base] = value;
      } else {
        extras.unknown.push({ key, value });
      }
      continue;
    }

    if (key === 'Name') {
      name = value;
    } else if (isGlobalKey(key)) {
      globalRaw[key] = parseIntValue(value, GLOBAL_KEY_DEFAULTS[key]);
    } else {
      extras.unknown.push({ key, value });
    }
  }

  for (let i = 0; i < NUM_PARTS; i++) {
    const raw = tgRaw[i]!;
    const patch: Partial<PartConfig> = {};
    if (raw.midi !== undefined) Object.assign(patch, mapMidiChannel(raw.midi));
    if (raw.volume !== undefined) patch.volume = raw.volume / 127;
    if (raw.pan !== undefined) patch.pan = mapPan(raw.pan);
    if (raw.detune !== undefined) patch.detune = raw.detune;
    if (raw.noteLow !== undefined) patch.noteLow = raw.noteLow;
    if (raw.noteHigh !== undefined) patch.noteHigh = raw.noteHigh;
    if (raw.noteShift !== undefined) patch.noteShift = raw.noteShift;
    if (raw.cutoff !== undefined) patch.cutoff = fromCc99(raw.cutoff);
    if (raw.resonance !== undefined) patch.resonance = fromCc99(raw.resonance);
    if (raw.reverbSend !== undefined) patch.reverbSend = fromCc99(raw.reverbSend);
    parts[i] = patch;
    if (raw.voiceData !== undefined) {
      voices[i] = decodeVoiceDataHex(raw.voiceData);
    }
  }

  const g = { ...GLOBAL_KEY_DEFAULTS, ...globalRaw };
  const global: MiniDexedGlobals = {
    compressor: g.CompressorEnable !== 0,
    reverb: {
      ...DEFAULT_REVERB_SETTINGS,
      enabled: g.ReverbEnable !== 0,
      size: fromCc99(g.ReverbSize),
      hiDamp: fromCc99(g.ReverbHighDamp),
      loDamp: fromCc99(g.ReverbLowDamp),
      lowpass: fromCc99(g.ReverbLowPass),
      diffusion: fromCc99(g.ReverbDiffusion),
      level: fromCc99(g.ReverbLevel),
    },
  };

  return { name, parts, voices, global, extras };
}

function mergeExtras(base: MiniDexedExtras | null | undefined): MiniDexedExtras {
  const out = emptyExtras();
  if (base) {
    out.preamble = [...base.preamble];
    out.unknown = [...base.unknown];
    for (let i = 0; i < NUM_PARTS; i++) {
      out.tg[i] = { ...base.tg[i] };
    }
  }
  for (let i = 0; i < NUM_PARTS; i++) {
    out.tg[i] = { ...DEFAULT_TG_EXTRAS, ...out.tg[i] };
  }
  return out;
}

export function serializeMiniDexedIni(input: SerializeMiniDexedIniInput): string {
  const extras = mergeExtras(input.extras);
  const lines: string[] = [];

  if (extras.preamble.length) {
    lines.push(...extras.preamble);
  }

  const name = input.name?.trim();
  if (name) {
    lines.push(`Name=${name}`);
    lines.push('');
  }

  for (let i = 0; i < NUM_PARTS; i++) {
    const tg = i + 1;
    const cfg = input.parts[i];
    const voice = input.voices[i];
    const preserved = extras.tg[i]!;

    lines.push(`# TG${tg}`);

    lines.push(`BankNumber${tg}=${preserved.BankNumber ?? '0'}`);
    lines.push(`VoiceNumber${tg}=${preserved.VoiceNumber ?? '1'}`);

    if (cfg) {
      lines.push(`MIDIChannel${tg}=${unmapMidiChannel(cfg)}`);
      lines.push(`Volume${tg}=${Math.round(Math.max(0, Math.min(1, cfg.volume)) * 127)}`);
      lines.push(`Pan${tg}=${unmapPan(cfg.pan)}`);
      lines.push(`Detune${tg}=${cfg.detune}`);
      lines.push(`Cutoff${tg}=${toCc99(cfg.cutoff)}`);
      lines.push(`Resonance${tg}=${toCc99(cfg.resonance)}`);
      lines.push(`NoteLimitLow${tg}=${cfg.noteLow}`);
      lines.push(`NoteLimitHigh${tg}=${cfg.noteHigh}`);
      lines.push(`NoteShift${tg}=${cfg.noteShift}`);
      lines.push(`ReverbSend${tg}=${toCc99(cfg.reverbSend)}`);
    }

    for (const key of PRESERVED_TG_KEYS) {
      if (key === 'BankNumber' || key === 'VoiceNumber') continue;
      lines.push(`${key}${tg}=${preserved[key] ?? DEFAULT_TG_EXTRAS[key]}`);
    }

    const voiceHex = voice && voice.length >= 155 ? encodeVoiceDataHex(voice) : '';
    lines.push(`VoiceData${tg}=${voiceHex}`);
    lines.push('');
  }

  const { compressor, reverb } = input.global;
  lines.push(`CompressorEnable=${compressor ? 1 : 0}`);
  lines.push(`ReverbEnable=${reverb.enabled ? 1 : 0}`);
  lines.push(`ReverbSize=${toCc99(reverb.size)}`);
  lines.push(`ReverbHighDamp=${toCc99(reverb.hiDamp)}`);
  lines.push(`ReverbLowDamp=${toCc99(reverb.loDamp)}`);
  lines.push(`ReverbLowPass=${toCc99(reverb.lowpass)}`);
  lines.push(`ReverbDiffusion=${toCc99(reverb.diffusion)}`);
  lines.push(`ReverbLevel=${toCc99(reverb.level)}`);

  for (const { key, value } of extras.unknown) {
    lines.push(`${key}=${value}`);
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
