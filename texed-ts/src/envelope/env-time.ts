// Shared envelope time scale and display-parameter helpers.
//
// All seven envelopes (6 operators + pitch EG) share one time mapping so they
// are "zoomed in at the same level". The gate (key-off) time is chosen so every
// envelope has reached its sustain before release, and the axis spans from the
// fastest attack to the slowest release.

import { useRef } from 'react';
import { scaleoutlevel } from '@texed/dx7-engine/env';
import { operatorOutLevel, scaleRate } from '@texed/dx7-engine/dx7note';
import { OP, G, opBase } from '@texed/dx7-format/voice';
import { FULL_VIEW, type EnvView } from '../state/env-axis';
import {
  ampStageTimes,
  pitchStageTimes,
  simulateAmpEnv,
  simulatePitchEnv,
  type AmpEnvParams,
} from '@texed/dx7-engine/env-sim';

// Default reference note/velocity: rate scaling and level scaling are
// note/velocity dependent, so the drawn curve is pinned to one playing context.
// These are the fallbacks; the actual values are user-editable (see App state).
export const REF_NOTE = 60;
export const REF_VELOCITY = 99;

export type TimeMode = 'log' | 'linear';

/** Combined per-operator output level and rate scaling (dx7note.ts init). */
export function computeAmpParams(
  voice: ArrayLike<number>,
  opNum: number,
  scaleByOutlevel = true,
  note = REF_NOTE,
  velocity = REF_VELOCITY,
): AmpEnvParams {
  const base = opBase(opNum);
  const rates = [
    voice[base + OP.egRate(0)],
    voice[base + OP.egRate(1)],
    voice[base + OP.egRate(2)],
    voice[base + OP.egRate(3)],
  ];
  const levels = [
    voice[base + OP.egLevel(0)],
    voice[base + OP.egLevel(1)],
    voice[base + OP.egLevel(2)],
    voice[base + OP.egLevel(3)],
  ];

  const outlevel = scaleByOutlevel
    ? operatorOutLevel(voice, base, note, velocity)
    : scaleoutlevel(99) << 5;

  const rateScaling = scaleRate(note, voice[base + OP.rateScaling]);
  return { rates, levels, outlevel, rateScaling };
}

export function pitchEgParams(voice: ArrayLike<number>): { rates: number[]; levels: number[] } {
  return {
    rates: [
      voice[G.pitchEgRate(0)],
      voice[G.pitchEgRate(1)],
      voice[G.pitchEgRate(2)],
      voice[G.pitchEgRate(3)],
    ],
    levels: [
      voice[G.pitchEgLevel(0)],
      voice[G.pitchEgLevel(1)],
      voice[G.pitchEgLevel(2)],
      voice[G.pitchEgLevel(3)],
    ],
  };
}

const T0 = 0.05; // log-time reference: 50 ms
const LINEAR_MAX = 10; // linear mode clamps the axis here (with an overflow chevron)

export interface Gridline {
  x01: number;
  label: string;
}

export interface EnvTimeScale {
  mode: TimeMode;
  gateSec: number;
  tMaxSec: number;
  zoom: number; // 1 = the whole axis is visible
  clamped: boolean; // true if some envelope extends past the right edge
  clippedLeft: boolean; // true if the view has been panned past t = 0
  /** time (sec) → 0..1 across the plot width. Outside 0..1 when zoomed. */
  x: (sec: number) => number;
  /** 0..1 → time (sec). */
  t: (x01: number) => number;
  gridlines: Gridline[];
}

/** Gate time and total span of a voice's envelopes: the axis before zoom. */
interface EnvSpan {
  gateSec: number;
  maxReleaseEnd: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function formatTime(sec: number): string {
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  if (sec < 10) return `${sec.toFixed(sec < 2 ? 1 : 0)}s`;
  return `${Math.round(sec)}s`;
}

function makeScale(mode: TimeMode, span: EnvSpan, view: EnvView): EnvTimeScale {
  const { gateSec, maxReleaseEnd } = span;
  const axisMax =
    mode === 'log'
      ? clamp(maxReleaseEnd, 1, 60)
      : Math.min(clamp(maxReleaseEnd, 0.25, 60), LINEAR_MAX);

  const denom = Math.log2(1 + axisMax / T0);
  // The unzoomed mapping. Clamping here parks anything past the axis on its
  // edge, which is what the overflow chevron then reports.
  const baseX =
    mode === 'log'
      ? (sec: number) => clamp(Math.log2(1 + Math.max(0, sec) / T0) / denom, 0, 1)
      : (sec: number) => clamp(Math.max(0, sec) / axisMax, 0, 1);
  const baseT =
    mode === 'log'
      ? (x01: number) => (Math.pow(2, clamp(x01, 0, 1) * denom) - 1) * T0
      : (x01: number) => clamp(x01, 0, 1) * axisMax;

  const { zoom, pan } = view;
  const x = (sec: number) => (baseX(sec) - pan) * zoom;
  const t = (x01: number) => baseT(x01 / zoom + pan);

  const gridlines: Gridline[] = gridTicks(mode, t(0), t(1)).map((s) => ({
    x01: x(s),
    label: formatTime(s),
  }));

  return {
    mode,
    gateSec,
    tMaxSec: axisMax,
    zoom,
    clamped: maxReleaseEnd > t(1) * 1.001,
    clippedLeft: pan > 0,
    x,
    t,
    gridlines,
  };
}

/** Round ticks covering the visible time range, at most about ten of them. */
function gridTicks(mode: TimeMode, t0: number, t1: number): number[] {
  const out: number[] = [];
  if (mode === 'log') {
    // Below 5 ms the log axis is too compressed for a label to mean anything.
    const lo = Math.max(t0, 0.005);
    if (t1 <= lo) return out;
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(t1)); e++) {
      for (const m of [1, 2, 5]) {
        const s = Number((m * 10 ** e).toPrecision(12));
        if (s >= lo && s <= t1) out.push(s);
      }
    }
    const decades = out.filter((s) => Number.isInteger(Math.log10(s)));
    return out.length > 10 ? decades : out;
  }
  const step = niceStep((t1 - t0) / 6);
  for (let k = Math.ceil(t0 / step); k * step <= t1; k++) {
    if (k > 0) out.push(Number((k * step).toPrecision(12)));
  }
  return out;
}

/** The 1/2/5 × 10ⁿ step nearest above `x`. */
function niceStep(x: number): number {
  const e = 10 ** Math.floor(Math.log10(Math.max(x, 1e-6)));
  const m = x / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}

/**
 * Compute the shared scale from the whole voice: gate is just past the slowest
 * time-to-sustain; the axis spans to the slowest release end.
 */
export function computeEnvTimeScale(
  voice: ArrayLike<number>,
  mode: TimeMode,
  note = REF_NOTE,
  velocity = REF_VELOCITY,
  view: EnvView = FULL_VIEW,
): EnvTimeScale {
  return makeScale(mode, computeEnvSpan(voice, note, velocity), view);
}

function computeEnvSpan(voice: ArrayLike<number>, note: number, velocity: number): EnvSpan {
  let maxSustain = 0;
  const ampParams: AmpEnvParams[] = [];
  for (let opNum = 1; opNum <= 6; opNum++) {
    const p = computeAmpParams(voice, opNum, true, note, velocity);
    ampParams.push(p);
    maxSustain = Math.max(maxSustain, ampStageTimes(p)[2]);
  }
  const peg = pitchEgParams(voice);
  maxSustain = Math.max(maxSustain, pitchStageTimes(peg.rates, peg.levels)[2]);

  const gateCore = clamp(maxSustain, 0.05, 30);
  const gateSec = gateCore + Math.max(0.25, 0.1 * gateCore);

  // Axis spans to the slowest release end. The trace releases at max(gateSec,
  // its own sustain), so releaseEndSec is already on the shared timeline.
  let maxReleaseEnd = gateSec;
  for (const p of ampParams) {
    maxReleaseEnd = Math.max(maxReleaseEnd, simulateAmpEnv(p, gateSec).releaseEndSec);
  }
  maxReleaseEnd = Math.max(
    maxReleaseEnd,
    simulatePitchEnv(peg.rates, peg.levels, gateSec).releaseEndSec,
  );

  return { gateSec, maxReleaseEnd };
}

/**
 * React hook: shared time scale, recomputed only when the EG params change.
 *
 * Every parameter edit hands down a fresh `voice` array, so a `useMemo` on
 * `voice` would recompute on each keystroke anywhere in the editor. Caching on
 * the value of the params the curves actually depend on limits the work to edits
 * that can change the result. The span - the part that replays all seven
 * envelopes - is cached separately from the scale so a zoom or pan, which only
 * moves the window over it, does not re-simulate anything.
 *
 * `frozen` holds the last computed scale regardless of the params - see
 * state/env-axis.ts for why a drag needs that.
 */
export function useEnvTimeScale(
  voice: ArrayLike<number>,
  mode: TimeMode,
  note = REF_NOTE,
  velocity = REF_VELOCITY,
  frozen = false,
  view: EnvView = FULL_VIEW,
): EnvTimeScale {
  const span = useRef<{ key: string; value: EnvSpan } | null>(null);
  const scale = useRef<{ key: string; value: EnvTimeScale } | null>(null);
  // Before the key, which is itself not free to build on every pointer event.
  if (frozen && scale.current) return scale.current.value;

  const spanKey = `${envDepKey(voice)}|${note}|${velocity}`;
  if (span.current?.key !== spanKey) {
    span.current = { key: spanKey, value: computeEnvSpan(voice, note, velocity) };
  }
  const scaleKey = `${spanKey}|${mode}|${view.zoom}|${view.pan}`;
  if (scale.current?.key !== scaleKey) {
    scale.current = { key: scaleKey, value: makeScale(mode, span.current.value, view) };
  }
  return scale.current.value;
}

/** Hash of every param the seven envelope curves depend on. */
function envDepKey(voice: ArrayLike<number>): string {
  const bytes: number[] = [];
  for (let opNum = 1; opNum <= 6; opNum++) {
    const base = opBase(opNum);
    for (let i = 0; i < 8; i++) bytes.push(voice[base + i]); // R1-4, L1-4
    bytes.push(voice[base + OP.outputLevel]);
    bytes.push(voice[base + OP.rateScaling]);
    bytes.push(voice[base + OP.velocitySens]);
    for (const o of [OP.breakPoint, OP.leftDepth, OP.rightDepth, OP.leftCurve, OP.rightCurve])
      bytes.push(voice[base + o]);
  }
  for (let i = 0; i < 4; i++) bytes.push(voice[G.pitchEgRate(i)], voice[G.pitchEgLevel(i)]);
  return bytes.join(',');
}
