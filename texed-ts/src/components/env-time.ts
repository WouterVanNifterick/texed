// Shared envelope time scale and display-parameter helpers.
//
// All seven envelopes (6 operators + pitch EG) share one time mapping so they
// are "zoomed in at the same level". The gate (key-off) time is chosen so every
// envelope has reached its sustain before release, and the axis spans from the
// fastest attack to the slowest release.

import { useMemo } from 'react';
import { scaleoutlevel } from '../engine/env';
import { scaleLevel, scaleRate, scaleVelocity } from '../engine/dx7note';
import { OP, G, opBase } from '../state/params';
import {
  ampStageTimes,
  pitchStageTimes,
  simulateAmpEnv,
  simulatePitchEnv,
  type AmpEnvParams,
} from '../engine/env-sim';

// Deterministic reference note/velocity: rate scaling and level scaling are
// note/velocity dependent, so the drawn curve is pinned to one playing context.
export const REF_NOTE = 60;
export const REF_VELOCITY = 99;
export const REF_LABEL = 'note 60 · vel 99';

export type TimeMode = 'log' | 'linear';

/** Combined per-operator output level and rate scaling (dx7note.ts init). */
export function computeAmpParams(voice: Uint8Array, opNum: number): AmpEnvParams {
  const base = opBase(opNum);
  const rates = [voice[base + OP.egRate(0)], voice[base + OP.egRate(1)], voice[base + OP.egRate(2)], voice[base + OP.egRate(3)]];
  const levels = [voice[base + OP.egLevel(0)], voice[base + OP.egLevel(1)], voice[base + OP.egLevel(2)], voice[base + OP.egLevel(3)]];

  let outlevel = scaleoutlevel(voice[base + OP.outputLevel]);
  outlevel += scaleLevel(
    REF_NOTE,
    voice[base + OP.breakPoint],
    voice[base + OP.leftDepth],
    voice[base + OP.rightDepth],
    voice[base + OP.leftCurve],
    voice[base + OP.rightCurve],
  );
  outlevel = Math.min(127, outlevel);
  outlevel = outlevel << 5;
  outlevel += scaleVelocity(REF_VELOCITY, voice[base + OP.velocitySens]);
  outlevel = Math.max(0, outlevel);

  const rateScaling = scaleRate(REF_NOTE, voice[base + OP.rateScaling]);
  return { rates, levels, outlevel, rateScaling };
}

export function pitchEgParams(voice: Uint8Array): { rates: number[]; levels: number[] } {
  return {
    rates: [voice[G.pitchEgRate(0)], voice[G.pitchEgRate(1)], voice[G.pitchEgRate(2)], voice[G.pitchEgRate(3)]],
    levels: [voice[G.pitchEgLevel(0)], voice[G.pitchEgLevel(1)], voice[G.pitchEgLevel(2)], voice[G.pitchEgLevel(3)]],
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
  clamped: boolean; // true if some envelope extends past the visible axis
  /** time (sec) → 0..1 across the plot width. */
  x: (sec: number) => number;
  /** 0..1 → time (sec). */
  t: (x01: number) => number;
  gridlines: Gridline[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function formatTime(sec: number): string {
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  if (sec < 10) return `${sec.toFixed(sec < 2 ? 1 : 0)}s`;
  return `${Math.round(sec)}s`;
}

function makeScale(mode: TimeMode, gateSec: number, maxReleaseEnd: number): EnvTimeScale {
  const axisMax = mode === 'log' ? clamp(maxReleaseEnd, 1, 60) : Math.min(clamp(maxReleaseEnd, 0.25, 60), LINEAR_MAX);
  const clamped = maxReleaseEnd > axisMax * 1.001;

  const denom = Math.log2(1 + axisMax / T0);
  const x =
    mode === 'log'
      ? (sec: number) => clamp(Math.log2(1 + Math.max(0, sec) / T0) / denom, 0, 1)
      : (sec: number) => clamp(Math.max(0, sec) / axisMax, 0, 1);
  const t =
    mode === 'log'
      ? (x01: number) => (Math.pow(2, clamp(x01, 0, 1) * denom) - 1) * T0
      : (x01: number) => clamp(x01, 0, 1) * axisMax;

  // Gridlines at decade-ish marks within the axis.
  const candidates = mode === 'log' ? [0.01, 0.1, 1, 10] : niceLinearTicks(axisMax);
  const gridlines: Gridline[] = candidates
    .filter((s) => s > 0 && s <= axisMax)
    .map((s) => ({ x01: x(s), label: formatTime(s) }));

  return { mode, gateSec, tMaxSec: axisMax, clamped, x, t, gridlines };
}

function niceLinearTicks(axisMax: number): number[] {
  const step = axisMax <= 1 ? 0.2 : axisMax <= 3 ? 0.5 : axisMax <= 6 ? 1 : 2;
  const out: number[] = [];
  for (let s = step; s < axisMax; s += step) out.push(Number(s.toFixed(3)));
  return out;
}

/**
 * Compute the shared scale from the whole voice: gate is just past the slowest
 * time-to-sustain; the axis spans to the slowest release end.
 */
export function computeEnvTimeScale(voice: Uint8Array, mode: TimeMode): EnvTimeScale {
  let maxSustain = 0;
  const ampParams: AmpEnvParams[] = [];
  for (let opNum = 1; opNum <= 6; opNum++) {
    const p = computeAmpParams(voice, opNum);
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
  maxReleaseEnd = Math.max(maxReleaseEnd, simulatePitchEnv(peg.rates, peg.levels, gateSec).releaseEndSec);

  return makeScale(mode, gateSec, maxReleaseEnd);
}

/** React hook: memoized shared time scale, recomputed only when EG bytes change. */
export function useEnvTimeScale(voice: Uint8Array, mode: TimeMode): EnvTimeScale {
  const key = useMemo(() => envDepKey(voice), [voice]);
  return useMemo(() => computeEnvTimeScale(voice, mode), [key, mode]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Hash of every byte the seven envelope curves depend on. */
function envDepKey(voice: Uint8Array): string {
  const bytes: number[] = [];
  for (let opNum = 1; opNum <= 6; opNum++) {
    const base = opBase(opNum);
    for (let i = 0; i < 8; i++) bytes.push(voice[base + i]); // R1-4, L1-4
    bytes.push(voice[base + OP.outputLevel]);
    bytes.push(voice[base + OP.rateScaling]);
    bytes.push(voice[base + OP.velocitySens]);
    for (const o of [OP.breakPoint, OP.leftDepth, OP.rightDepth, OP.leftCurve, OP.rightCurve]) bytes.push(voice[base + o]);
  }
  for (let i = 0; i < 4; i++) bytes.push(voice[G.pitchEgRate(i)], voice[G.pitchEgLevel(i)]);
  return bytes.join(',');
}
