// Copying one operator, or just its envelope, onto another - and onto or from
// the pitch EG.
//
// A module slot rather than the system clipboard: the payload is raw voice
// bytes with no useful text form, and reading the real clipboard costs an async
// permission prompt on every paste. A copy always captures the operator *and*
// its envelope, so how much of it lands is decided at paste time - Ctrl+V
// versus Ctrl+Shift+V, or which part of a panel a drag is dropped on.
//
// Everything here is pure except the store at the bottom; the synth wiring
// lives in useOpClipboard.ts.

import { useSyncExternalStore } from 'react';
import { G, OP, opBase } from '@texed/dx7-format/voice';
import {
  getAms,
  getScalingMode,
  setAms,
  setScalingMode,
  type ByteEdit,
} from '@texed/dx7-format/supplement';
import type { EnvSelection } from '../envelope/env-draw';

/** Bytes in one operator's block of the unpacked voice. */
const OP_BYTES = 21;

/** How much of a clip to apply: the whole operator, or only its EG. */
export type PasteMode = 'all' | 'env';

/** What an action does. `swap` exchanges two operators outright. */
export type ActionKind = PasteMode | 'swap';

export interface OpClip {
  /** Where it was taken from: operator 1..6, or the pitch EG. */
  source: EnvSelection;
  /** The 21 operator bytes; null for a pitch EG clip, which has none. */
  params: Uint8Array | null;
  /** AMEM extras that belong to the operator (unused by a pitch clip). */
  ams: number;
  fract: boolean;
  /** EG rates and levels - every clip carries an envelope. */
  rates: number[];
  levels: number[];
}

/** A planned edit, as the byte changes it comes down to. */
export interface Edits {
  voice: ByteEdit[];
  supplement: ByteEdit[];
}

export function selName(sel: EnvSelection): string {
  return sel === 'pitch' ? 'PITCH EG' : `OP${sel}`;
}

/** Voice offsets of the four EG rates and levels of an operator or the pitch EG. */
function egOffsets(sel: EnvSelection): { rates: number[]; levels: number[] } {
  const stages = [0, 1, 2, 3];
  if (sel === 'pitch') {
    return { rates: stages.map(G.pitchEgRate), levels: stages.map(G.pitchEgLevel) };
  }
  const base = opBase(sel);
  return {
    rates: stages.map((i) => base + OP.egRate(i)),
    levels: stages.map((i) => base + OP.egLevel(i)),
  };
}

/**
 * Snapshot whatever `sel` points at.
 *
 * AMS spans two stores - 0-3 in the voice, the DX7II extension 4-7 in the AMEM
 * supplement - so the voice byte rides along inside `params` and the supplement
 * nibble is kept beside it. Together they reproduce the operator exactly.
 */
export function readClip(voice: Uint8Array, supplement: Uint8Array, sel: EnvSelection): OpClip {
  const eg = egOffsets(sel);
  const env = { rates: eg.rates.map((o) => voice[o]), levels: eg.levels.map((o) => voice[o]) };
  if (sel === 'pitch') return { source: sel, params: null, ams: 0, fract: false, ...env };
  const base = opBase(sel);
  const opIdx = 6 - sel; // sysex order, which is what the supplement is keyed by
  return {
    source: sel,
    params: voice.slice(base, base + OP_BYTES),
    ams: getAms(supplement, opIdx),
    fract: getScalingMode(supplement, opIdx),
    ...env,
  };
}

/**
 * The mode a paste will really use. Operator parameters have nowhere to go on
 * the pitch EG, and a pitch clip has none to give, so either pairing falls back
 * to the envelope on its own.
 */
export function effectiveMode(clip: OpClip, target: EnvSelection, mode: PasteMode): PasteMode {
  if (mode === 'env' || !clip.params || target === 'pitch') return 'env';
  return 'all';
}

/**
 * Working copies of both buffers, so overlapping bit fields chain correctly:
 * the AMEM fractional-scaling flags for all six operators share one byte and
 * AMS shares a byte per pair, so a swap computed against the original
 * supplement would write half of it and then throw that half away.
 */
function planner(voice: Uint8Array, supplement: Uint8Array) {
  return { voice: new Uint8Array(voice), supplement: new Uint8Array(supplement) };
}

function diff(from: Uint8Array, to: Uint8Array): ByteEdit[] {
  const out: ByteEdit[] = [];
  for (let i = 0; i < to.length; i++) {
    if (to[i] !== from[i]) out.push({ offset: i, value: to[i] });
  }
  return out;
}

function writeClip(
  p: ReturnType<typeof planner>,
  clip: OpClip,
  target: EnvSelection,
  mode: PasteMode,
): void {
  if (mode === 'all') {
    const opNum = target as number;
    const opIdx = 6 - opNum;
    p.voice.set(clip.params!, opBase(opNum));
    const ams = setAms(p.supplement, opIdx, clip.ams);
    p.supplement[ams.offset] = ams.value;
    const fract = setScalingMode(p.supplement, opIdx, clip.fract);
    p.supplement[fract.offset] = fract.value;
    return;
  }
  // Envelope only. The eight numbers transfer as stored: on the pitch EG a level
  // of 50 means "no pitch change" rather than silence, so pasting an operator's
  // EG there reshapes the curve instead of reproducing it - which is the point.
  const eg = egOffsets(target);
  for (let i = 0; i < 4; i++) {
    p.voice[eg.rates[i]] = clip.rates[i];
    p.voice[eg.levels[i]] = clip.levels[i];
  }
}

export function planPaste(
  voice: Uint8Array,
  supplement: Uint8Array,
  clip: OpClip,
  target: EnvSelection,
  mode: PasteMode,
): Edits {
  const p = planner(voice, supplement);
  writeClip(p, clip, target, effectiveMode(clip, target, mode));
  return { voice: diff(voice, p.voice), supplement: diff(supplement, p.supplement) };
}

/** Exchange two operators, AMEM extras included. */
export function planSwap(voice: Uint8Array, supplement: Uint8Array, a: number, b: number): Edits {
  const clipA = readClip(voice, supplement, a);
  const clipB = readClip(voice, supplement, b);
  const p = planner(voice, supplement);
  writeClip(p, clipB, a, 'all');
  writeClip(p, clipA, b, 'all');
  return { voice: diff(voice, p.voice), supplement: diff(supplement, p.supplement) };
}

export function hasEdits(edits: Edits): boolean {
  return edits.voice.length > 0 || edits.supplement.length > 0;
}

/** The two ends of an action: "OP3 envelope → OP5", "OP3 ↔ OP5". */
function pair(clip: OpClip, target: EnvSelection, kind: ActionKind): string {
  const from = selName(clip.source);
  const to = selName(target);
  if (kind === 'swap') return `${from} ↔ ${to}`;
  return `${from}${kind === 'env' ? ' envelope' : ''} → ${to}`;
}

/** Imperative summary, for the hint drawn on a drop target. */
export function dropLabel(clip: OpClip, target: EnvSelection, kind: ActionKind): string {
  return `${kind === 'swap' ? 'Swap' : 'Copy'} ${pair(clip, target, kind)}`;
}

/** Past-tense summary, for the status message once the edit has landed. */
export function doneLabel(clip: OpClip, target: EnvSelection, kind: ActionKind): string {
  return `${kind === 'swap' ? 'Swapped' : 'Pasted'} ${pair(clip, target, kind)}`;
}

export interface DropAction {
  kind: ActionKind;
  target: EnvSelection;
  label: string;
  /** A modifier worth mentioning while the pointer is here, if any. */
  note?: string;
  /**
   * The target's envelope graph is a drop zone in its own right, meaning this
   * drag has two possible outcomes depending on where it lands. False when both
   * would come to the same thing - a pitch EG at either end has only its
   * envelope either way - and the target is then one undivided zone.
   */
  envZone: boolean;
}

/**
 * What dropping `clip` on `target` would do, or null if nothing would.
 *
 * `overEnv` is true when the cursor sits on the target's envelope graph, which
 * is what narrows a whole-operator drag down to its EG; `alt` turns a copy into
 * a swap. Both are read fresh on every dragover, so the hint tracks the keys.
 */
export function resolveDrop(
  clip: OpClip | null,
  target: EnvSelection,
  overEnv: boolean,
  alt: boolean,
): DropAction | null {
  if (!clip || clip.source === target) return null;
  const mode = effectiveMode(clip, target, overEnv ? 'env' : 'all');
  const kind: ActionKind = mode === 'all' && alt ? 'swap' : mode;
  return {
    kind,
    target,
    label: dropLabel(clip, target, kind),
    note: kind === 'all' ? 'hold Alt to swap' : undefined,
    envZone: effectiveMode(clip, target, 'all') === 'all',
  };
}

// ==== The clipboard slot, and the drag in flight ====

let clip: OpClip | null = null;
let drag: OpClip | null = null;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

function publish(): void {
  subs.forEach((cb) => cb());
}

export function getOpClip(): OpClip | null {
  return clip;
}

export function setOpClip(next: OpClip | null): void {
  clip = next;
  publish();
}

/**
 * The clip a drag is carrying, kept apart from the clipboard: dragging one
 * operator onto another should not throw away what you copied earlier.
 */
export function getOpDrag(): OpClip | null {
  return drag;
}

export function setOpDrag(next: OpClip | null): void {
  drag = next;
  publish();
}

export function useOpDrag(): OpClip | null {
  return useSyncExternalStore(subscribe, getOpDrag);
}
