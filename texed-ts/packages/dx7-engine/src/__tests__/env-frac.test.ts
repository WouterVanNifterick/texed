// Reading the DX7 envelope tables at a fractional index.
//
// The editor solves an envelope drag between two whole parameter values, so the
// node can follow the cursor instead of snapping across the gaps the raw tables
// leave (42 of the 99 EG-level steps change nothing at all; the pitch EG rate
// table has a x2 jump). Only env-sim - the visualization - evaluates them that
// way; the engine is handed the rounded value and never sees a fraction.
//
// The contract that makes this safe: lerpAt is *exact* at integers, so env-sim
// still agrees with the engine bit-for-bit on every real patch.

import { describe, it, expect } from 'vitest';
import {
  lerpAt,
  scaleoutlevel,
  ampLevelBase,
  ampIncAt,
  ampStaticAt,
  pitchIncAt,
  pitchLevelAt,
} from '../env-tables';

const SR_MUL = 1 << 24;
const PITCH_UNIT = 1143;

/** Every interpolated map, as a single-argument function of its param. */
const MAPS: { name: string; f: (x: number) => number }[] = [
  { name: 'scaleoutlevel', f: (x) => lerpAt(scaleoutlevel, x) },
  { name: 'ampLevelBase', f: (x) => lerpAt(ampLevelBase, x) },
  { name: 'ampIncAt', f: (x) => lerpAt(ampIncAt, x, SR_MUL, 0) },
  { name: 'ampIncAt (rate scaled)', f: (x) => lerpAt(ampIncAt, x, SR_MUL, 7) },
  { name: 'ampStaticAt', f: (x) => lerpAt(ampStaticAt, x, SR_MUL, 0) },
  { name: 'ampStaticAt (short hold)', f: (x) => lerpAt(ampStaticAt, x, SR_MUL, 1) },
  { name: 'pitchIncAt', f: (x) => lerpAt(pitchIncAt, x, PITCH_UNIT) },
  { name: 'pitchLevelAt', f: (x) => lerpAt(pitchLevelAt, x) },
];

describe('lerpAt is exact at integers', () => {
  for (const { name, f } of MAPS) {
    it(name, () => {
      for (let i = 0; i <= 99; i++) {
        expect(f(i), `at ${i}`).toBe(f(i));
        expect(Number.isFinite(f(i)), `finite at ${i}`).toBe(true);
      }
    });
  }

  // The x === i early return is the only thing keeping f(100) from being read.
  it('never reads past the end of a 0..99 table', () => {
    expect(lerpAt(pitchLevelAt, 99)).toBe(pitchLevelAt(99));
    expect(lerpAt(pitchIncAt, 99, PITCH_UNIT)).toBe(pitchIncAt(99, PITCH_UNIT));
  });

  it('reproduces the raw table expression', () => {
    for (let l = 0; l <= 99; l++) {
      expect(lerpAt(ampLevelBase, l)).toBe((scaleoutlevel(l) >> 1) << 6);
    }
  });
});

describe('interpolated maps are continuous and never overshoot', () => {
  // Global monotonicity is deliberately NOT asserted: ampStaticAt jumps by x20
  // between staticrate 76 and 77, because msfa applies the short-hold /20 only
  // on the tabulated side of that boundary. That discontinuity is in the real
  // engine at integer rates too, so interpolation has to reproduce it, not
  // smooth it away.
  for (const { name, f } of MAPS) {
    it(name, () => {
      let prev = f(0);
      let worstJump = 0;
      for (let x = 0.01; x <= 99; x += 0.01) {
        const v = f(x);
        // Piecewise-linear: the value between two integers always lies within
        // the interval they bracket. No overshoot, no surprise values.
        const i = Math.floor(x);
        const [lo, hi] = [f(i), f(Math.min(99, i + 1))].sort((a, b) => a - b);
        expect(v, `at ${x}`).toBeGreaterThanOrEqual(lo - 1e-6);
        expect(v, `at ${x}`).toBeLessThanOrEqual(hi + 1e-6);
        worstJump = Math.max(worstJump, Math.abs(v - prev));
        prev = v;
      }
      // A hundredth of a param step can never move the result by more than a
      // hundredth of the largest whole step it sits on.
      const worstStep = Math.max(
        ...Array.from({ length: 99 }, (_, i) => Math.abs(f(i + 1) - f(i))),
      );
      expect(worstJump).toBeLessThanOrEqual(worstStep * 0.0101 + 1e-6);
    });
  }
});

describe('fractional params reach values the integer grid cannot', () => {
  for (const { name, f } of MAPS) {
    it(name, () => {
      // Find a step the table actually takes, and check the midpoint lands
      // strictly inside it - i.e. the fraction is not being silently dropped.
      const i = Array.from({ length: 99 }, (_, k) => k).find((k) => f(k + 1) !== f(k));
      expect(i, 'every map has at least one real step').toBeDefined();
      const [lo, hi] = [f(i!), f(i! + 1)].sort((a, b) => a - b);
      const mid = f(i! + 0.5);
      expect(mid).toBeGreaterThan(lo);
      expect(mid).toBeLessThan(hi);
      expect(mid).toBeCloseTo((lo + hi) / 2, 6);
    });
  }
});
