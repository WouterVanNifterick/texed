// Shared geometry for rendering envelope traces: maps Q24 levels to a 0..1
// vertical position (and back, for dragging) and builds SVG path strings.
// Used by both the single-envelope editor and the combined overlay so they
// stay pixel-consistent.

import {
  q24ToDb,
  q24ToAmp,
  dbToQ24,
  ampToQ24,
  DB_TOP,
  DB_FLOOR,
  AMP_TOP,
  type EnvTrace,
} from '@texed/dx7-engine/env-sim';
import type { EnvTimeScale } from './env-time';

export type YMode = 'db' | 'linear';
export type EnvKind = 'amp' | 'pitch';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Pitch EG spans about ±4 octaves (pitchenvTab 127<<19 ≈ 3.97 octaves).
const PITCH_OCT = 4;

export interface YMap {
  /** Q24 level → 0..1 (0 = top of plot). */
  levelToY01: (levelQ24: number) => number;
  /** 0..1 → Q24 level (inverse). */
  y01ToLevel: (y01: number) => number;
  /** Fill baseline (0..1): where the area fill closes back to. */
  baseline01: number;
}

export function makeYMap(kind: EnvKind, mode: YMode): YMap {
  if (kind === 'pitch') {
    return {
      levelToY01: (l) => clamp01((PITCH_OCT - l / (1 << 24)) / (2 * PITCH_OCT)),
      y01ToLevel: (y) => (PITCH_OCT - clamp01(y) * 2 * PITCH_OCT) * (1 << 24),
      baseline01: 0.5, // 0 octaves = no pitch change
    };
  }
  if (mode === 'linear') {
    return {
      levelToY01: (l) => clamp01(1 - q24ToAmp(l) / AMP_TOP),
      y01ToLevel: (y) => ampToQ24((1 - clamp01(y)) * AMP_TOP),
      baseline01: 1,
    };
  }
  const span = DB_TOP - DB_FLOOR;
  return {
    levelToY01: (l) => clamp01((DB_TOP - q24ToDb(l)) / span),
    y01ToLevel: (y) => dbToQ24(DB_TOP - clamp01(y) * span),
    baseline01: 1,
  };
}

export interface DrawGeom {
  W: number;
  H: number;
  pad: number;
  ts: EnvTimeScale;
  ymap: YMap;
}

export function px(g: DrawGeom, timeSec: number): number {
  return g.pad + g.ts.x(timeSec) * (g.W - 2 * g.pad);
}
export function py(g: DrawGeom, levelQ24: number): number {
  return g.pad + g.ymap.levelToY01(levelQ24) * (g.H - 2 * g.pad);
}

/** Polyline point string for the dense curve. */
export function curvePoints(trace: EnvTrace, g: DrawGeom): string {
  return trace.curve
    .map((p) => `${px(g, p.timeSec).toFixed(2)},${py(g, p.levelQ24).toFixed(2)}`)
    .join(' ');
}

/**
 * The curve split into solid vs "held" runs. A segment is held/indefinite when
 * it starts at or after the sustain and is visually horizontal — i.e. the
 * sustain plateau ([sustainSec, gateSec]) or a non-decaying release. The
 * `>= sustainSec` guard keeps asymptotically-flat attack tops solid. Adjacent
 * runs share their boundary vertex so the polylines stay visually connected.
 */
export function curveSegments(trace: EnvTrace, g: DrawGeom): { points: string; held: boolean }[] {
  const pts = trace.curve;
  if (pts.length === 0) return [];
  const xy = (p: { timeSec: number; levelQ24: number }) =>
    `${px(g, p.timeSec).toFixed(2)},${py(g, p.levelQ24).toFixed(2)}`;
  const held = (a: (typeof pts)[number], b: (typeof pts)[number]) =>
    a.timeSec >= trace.sustainSec - 1e-6 &&
    Math.abs(py(g, b.levelQ24) - py(g, a.levelQ24)) < 0.4 && // visually horizontal
    px(g, b.timeSec) - px(g, a.timeSec) > 0.3; // with real horizontal extent

  const out: { points: string; held: boolean }[] = [];
  let run = [xy(pts[0])];
  let runHeld = pts.length > 1 ? held(pts[0], pts[1]) : false;
  for (let i = 1; i < pts.length; i++) {
    const segHeld = held(pts[i - 1], pts[i]);
    if (segHeld !== runHeld) {
      out.push({ points: run.join(' '), held: runHeld });
      run = [xy(pts[i - 1])]; // repeat the boundary vertex to connect runs
      runHeld = segHeld;
    }
    run.push(xy(pts[i]));
  }
  out.push({ points: run.join(' '), held: runHeld });
  return out;
}

/** Filled polygon (curve closed to the baseline). */
export function fillPoints(trace: EnvTrace, g: DrawGeom): string {
  const y0 = g.pad + g.ymap.baseline01 * (g.H - 2 * g.pad);
  const first = trace.curve[0];
  const last = trace.curve[trace.curve.length - 1];
  return (
    `${px(g, first.timeSec).toFixed(2)},${y0.toFixed(2)} ` +
    curvePoints(trace, g) +
    ` ${px(g, last.timeSec).toFixed(2)},${y0.toFixed(2)}`
  );
}

/** [startSec, endSec] of the given stage, for the active-segment highlight. */
export function stageWindow(trace: EnvTrace, stage: number): [number, number] {
  if (stage <= 0) return [0, trace.nodes[0].timeSec];
  if (stage === 1) return [trace.nodes[0].timeSec, trace.nodes[1].timeSec];
  if (stage === 2) return [trace.nodes[1].timeSec, trace.nodes[2].timeSec];
  return [trace.gateSec, trace.releaseEndSec];
}

/**
 * Where the playback dot sits: the point on the active stage's curve at the live
 * envelope level. Level is monotonic within a stage, so the span containing that
 * level is unambiguous, and interpolating within it puts the dot at a fractional
 * time - the curve is only sampled ~18 times per stage, and snapping to those
 * samples made the dot visibly step. During a constant sustain/hold no span
 * contains the level, and it parks at the nearest end instead.
 */
export function playheadPoint(
  trace: EnvTrace,
  stage: number,
  levelQ24: number,
): { timeSec: number; levelQ24: number } | null {
  if (stage < 0 || stage > 3) return null;
  const [from, to] = stageWindow(trace, stage);
  const pts = trace.curve.filter((p) => p.timeSec >= from - 1e-6 && p.timeSec <= to + 1e-6);
  if (pts.length === 0) return null;

  let best = pts[0];
  let bestErr = Math.abs(best.levelQ24 - levelQ24);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const span = b.levelQ24 - a.levelQ24;
    if (span !== 0) {
      const f = (levelQ24 - a.levelQ24) / span;
      if (f >= 0 && f <= 1) return { timeSec: a.timeSec + f * (b.timeSec - a.timeSec), levelQ24 };
    }
    const err = Math.abs(b.levelQ24 - levelQ24);
    if (err < bestErr) {
      bestErr = err;
      best = b;
    }
  }
  return best;
}

export interface NodeGeom {
  x01: number; // 0..1 across width
  y01: number; // 0..1 down height
  stage: number;
  reached: boolean;
}

export function nodeGeoms(trace: EnvTrace, ts: EnvTimeScale, ymap: YMap): NodeGeom[] {
  return trace.nodes.map((n) => ({
    x01: ts.x(n.timeSec),
    y01: ymap.levelToY01(n.levelQ24),
    stage: n.stage,
    reached: n.reached,
  }));
}
