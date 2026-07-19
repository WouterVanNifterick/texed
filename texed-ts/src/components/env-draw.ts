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

// Per-operator colors live in state/op-colors so the algorithm diagram and
// panel headers share the exact same palette; re-exported here for the drawing
// modules that already import from env-draw.
export { OP_COLORS, PITCH_COLOR, opColor } from '../state/op-colors';

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
  return trace.curve.map((p) => `${px(g, p.timeSec).toFixed(2)},${py(g, p.levelQ24).toFixed(2)}`).join(' ');
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
