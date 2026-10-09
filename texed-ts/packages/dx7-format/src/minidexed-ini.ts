// MiniDexed performance.ini parse/serialize (8 tone generators).
// Maps core routing + VoiceData into PartConfig; other keys round-trip opaquely.

import type { PartConfig } from './part-config';
import { NUM_PARTS } from './part-config';
import { DEFAULT_REVERB_SETTINGS, type GlobalSettings } from './global-settings';
import { voiceFromRawVced } from './sysex';

const TG_SUFFIX = /^(.+?)(\d+)$/;

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

/**
 * Numeric per-TG keys mapped onto PartConfig (and so written from Texed part
 * state on save, not from extras): the value an unparsable number falls back
 * to, and where it lands.
 */
const TG_KEY_READERS = new Map<string, [number, (raw: number) => Partial<PartConfig>]>([
  ['MIDIChannel', [0, mapMidiChannel]],
  ['Volume', [100, (raw) => ({ volume: raw / 127 })]],
  ['Pan', [64, (raw) => ({ pan: mapPan(raw) })]],
  ['Detune', [0, (raw) => ({ detune: raw })]],
  ['NoteLimitLow', [0, (raw) => ({ noteLow: raw })]],
  ['NoteLimitHigh', [127, (raw) => ({ noteHigh: raw })]],
  ['NoteShift', [0, (raw) => ({ noteShift: raw })]],
  ['Cutoff', [99, (raw) => ({ cutoff: fromCc99(raw) })]],
  ['Resonance', [0, (raw) => ({ resonance: fromCc99(raw) })]],
  ['ReverbSend', [50, (raw) => ({ reverbSend: fromCc99(raw) })]],
]);

export function decodeVoiceDataHex(text: string): Uint8Array | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/\s+/);
  if (!tokens.every((t) => /^[0-9a-f]{2}$/i.test(t))) return null;
  return voiceFromRawVced(Uint8Array.from(tokens, (t) => Number.parseInt(t, 16)));
}

export function encodeVoiceDataHex(voice: Uint8Array): string {
  return Array.from(voice.subarray(0, 156), (b) =>
    b.toString(16).toUpperCase().padStart(2, '0'),
  ).join(' ');
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

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    const commentIdx = trimmed.indexOf('#');
    const body = (commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed).trim();
    const eq = body.indexOf('=');
    // Blank lines, comments and anything else that is not Key=Value.
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
      const reader = TG_KEY_READERS.get(base);
      if (reader) {
        const [fallback, read] = reader;
        Object.assign(parts[tg]!, read(parseIntValue(value, fallback)));
      } else if (base === 'VoiceData') {
        voices[tg] = decodeVoiceDataHex(value);
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

/** A private copy of `base` with every per-TG key present. */
function mergeExtras(base: MiniDexedExtras | null | undefined): MiniDexedExtras {
  return {
    preamble: [...(base?.preamble ?? [])],
    tg: Array.from({ length: NUM_PARTS }, (_, i) => ({ ...DEFAULT_TG_EXTRAS, ...base?.tg[i] })),
    unknown: [...(base?.unknown ?? [])],
  };
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
