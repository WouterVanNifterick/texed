// Dragging an envelope node solves two params at once: the level from the
// cursor's height and the rate from its distance to the previous node. These
// tests pin the two properties that make that feel right - the node stays under
// the cursor, and the nodes after it stay where they were.

import { describe, it, expect } from 'vitest';
import {
  simulateAmpEnv,
  simulatePitchEnv,
  ampTargetLevel,
  pitchTargetLevel,
  rateForStageDuration,
  levelForTarget,
  solveAmpNodeDrag,
  solvePitchNodeDrag,
  type AmpEnvParams,
  type EnvTrace,
} from '../env-sim';

const N = 64;
const SR = 44100;
const tPerBlock = N / SR;

// A stage always lasts a whole number of 64-sample blocks, so a solved duration
// can only ever be right to within one of them (~1.5 ms, under a pixel on the
// display's log axis). Where two solved stages compound, allow two.
const ONE_BLOCK = 1;
const TWO_BLOCKS = 2;

describe('amp EG node drag', () => {
  const p: AmpEnvParams = {
    rates: [70, 60, 40, 50],
    levels: [99, 80, 60, 0],
    outlevel: 99 << 5,
    rateScaling: 0,
  };
  // Well past every stage's sustain, standing in for the frozen display axis:
  // the gate must hold still while a drag is solved or the release node's origin
  // moves along with it.
  const GATE = 30;

  const traceFor = (rates: number[], levels: number[]) =>
    simulateAmpEnv({ ...p, rates, levels }, GATE);

  /** Per-stage durations. Stage 3 is measured from the gate, where it starts. */
  const durs = (t: EnvTrace): number[] => [
    t.nodes[0].timeSec,
    t.nodes[1].timeSec - t.nodes[0].timeSec,
    t.nodes[2].timeSec - t.nodes[1].timeSec,
    t.releaseEndSec - t.gateSec,
  ];
  const times = (t: EnvTrace): number[] => [
    t.nodes[0].timeSec,
    t.nodes[1].timeSec,
    t.nodes[2].timeSec,
    t.releaseEndSec,
  ];
  const base = simulateAmpEnv(p, GATE);

  /**
   * Whether any rate at all could give stage `stage` the duration `want`, given
   * these levels - sampled across the integer rate grid, which brackets what the
   * fractional range can reach.
   *
   * Several things put a duration out of reach: a stage dragged onto its own
   * start level becomes a hold, an attack to a low target finishes in one block
   * whatever the rate (the floor snap overshoots it), and a stage flipped from
   * decay to attack lands on a coarser staircase than the one it left. None of
   * those are solver faults, so the assertions below only apply where the wanted
   * duration is actually available.
   */
  const canReach = (rates: number[], levels: number[], stage: number, want: number) => {
    let min = Infinity;
    let max = -Infinity;
    const probe = [...rates];
    for (let r = 0; r <= 99; r++) {
      probe[stage] = r;
      const d = durs(traceFor(probe, levels))[stage];
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return want >= min - 1e-9 && want <= max + 1e-9;
  };

  it('the fixture sustains before the gate', () => {
    expect(base.sustainSec).toBeLessThan(GATE);
    expect(base.gateSec).toBe(GATE);
  });

  it('a vertical drag holds the dragged node in time', () => {
    for (const stage of [0, 1, 2, 3]) {
      const want = durs(base)[stage];
      for (let l = 2; l <= 97; l++) {
        const sol = solveAmpNodeDrag(p, stage, want, ampTargetLevel(l, p.outlevel));
        if (!canReach(sol.rates, sol.levels, stage, want)) continue;
        const got = durs(traceFor(sol.rates, sol.levels))[stage];
        expect(
          Math.abs(got - want) / tPerBlock,
          `stage ${stage} level ${l}: ${got}s, want ${want}s`,
        ).toBeLessThanOrEqual(ONE_BLOCK);
      }
    }
  });

  it('a vertical drag leaves later nodes at the same times', () => {
    const want = times(base);
    for (const stage of [0, 1, 2]) {
      const hold = durs(base)[stage];
      const followerHold = durs(base)[stage + 1];
      for (let l = 5; l <= 95; l++) {
        const sol = solveAmpNodeDrag(p, stage, hold, ampTargetLevel(l, p.outlevel));
        if (!canReach(sol.rates, sol.levels, stage, hold)) continue;
        if (!canReach(sol.rates, sol.levels, stage + 1, followerHold)) continue;
        const t = traceFor(sol.rates, sol.levels);
        for (let j = stage + 1; j <= 3; j++) {
          expect(
            Math.abs(times(t)[j] - want[j]) / tPerBlock,
            `drag stage ${stage} to level ${l}: node ${j} moved`,
          ).toBeLessThanOrEqual(TWO_BLOCKS);
        }
      }
    }
  });

  it('solving the rate against the pre-drag level is what moved the node', () => {
    // The old path: invert the rate from the params as they stand, then commit
    // the level underneath it. A stage's length is the distance it travels over
    // its slope, so changing the destination after picking the slope lands
    // somewhere else - the jitter this suite exists to pin down.
    const want = durs(base)[1];
    const dragTo = ampTargetLevel(40, p.outlevel);

    const staleRates = Array.from(p.rates);
    staleRates[1] = rateForStageDuration(p, 1, want, p.rates[1]);
    const staleLevels = Array.from(p.levels);
    staleLevels[1] = levelForTarget(dragTo, p.outlevel);
    const stale = Math.abs(durs(traceFor(staleRates, staleLevels))[1] - want) / tPerBlock;
    expect(stale).toBeGreaterThan(ONE_BLOCK);

    const sol = solveAmpNodeDrag(p, 1, want, dragTo);
    const fixed = Math.abs(durs(traceFor(sol.rates, sol.levels))[1] - want) / tPerBlock;
    expect(fixed).toBeLessThanOrEqual(ONE_BLOCK);
  });

  it('a horizontal drag still carries the key-on nodes along', () => {
    // Deliberately unchanged: pinning the follower preserves its *duration*, so
    // a node moved in time takes the ones after it with it. The release is the
    // exception - it hangs off the gate, and the sustain hold absorbs the shift.
    const stage = 1;
    const want = times(base);
    const sol = solveAmpNodeDrag(p, stage, durs(base)[stage] * 2, base.nodes[stage].levelQ24);
    const t = times(traceFor(sol.rates, sol.levels));
    const shift = t[stage] - want[stage];
    expect(shift / tPerBlock).toBeGreaterThan(ONE_BLOCK);
    expect(Math.abs(t[2] - want[2] - shift) / tPerBlock).toBeLessThanOrEqual(TWO_BLOCKS);
    expect(Math.abs(t[3] - want[3]) / tPerBlock).toBeLessThanOrEqual(TWO_BLOCKS);
  });

  it('rewrites only the dragged stage and its follower', () => {
    for (const stage of [0, 1, 2, 3]) {
      const sol = solveAmpNodeDrag(p, stage, durs(base)[stage], ampTargetLevel(45, p.outlevel));
      for (let i = 0; i < 4; i++) {
        if (i !== stage) expect(sol.levels[i], `stage ${stage}: L${i + 1}`).toBe(p.levels[i]);
        if (i !== stage && i !== stage + 1) {
          expect(sol.rates[i], `stage ${stage}: R${i + 1}`).toBe(p.rates[i]);
        }
      }
    }
  });
});

describe('pitch EG node drag', () => {
  const GATE = 30;
  const rates = [60, 50, 40, 55];
  const levels = [80, 30, 55, 50];
  const base = simulatePitchEnv(rates, levels, GATE);

  const durs = (t: EnvTrace): number[] => [
    t.nodes[0].timeSec,
    t.nodes[1].timeSec - t.nodes[0].timeSec,
    t.nodes[2].timeSec - t.nodes[1].timeSec,
    t.releaseEndSec - t.gateSec,
  ];
  const endOf = (t: EnvTrace, stage: number) =>
    stage === 3 ? t.releaseEndSec : t.nodes[stage].timeSec;

  /** As the amp version: is `want` a duration any rate could give this stage? */
  const canReach = (r: number[], levels: number[], stage: number, want: number) => {
    let min = Infinity;
    let max = -Infinity;
    const probe = [...r];
    for (let rate = 0; rate <= 99; rate++) {
      probe[stage] = rate;
      const d = durs(simulatePitchEnv(probe, levels, GATE))[stage];
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return want >= min - 1e-9 && want <= max + 1e-9;
  };

  it('dragging the release level holds stage 1, which starts from it', () => {
    // L4 is both the release target and the resting level stage 1 departs from,
    // so it is the one level whose follower wraps back around to stage 1.
    const want = durs(base)[3];
    const hold = durs(base)[0];
    let resolved = 0;
    for (let l = 5; l <= 95; l++) {
      const sol = solvePitchNodeDrag(rates, levels, 3, want, pitchTargetLevel(l));
      if (!canReach(sol.rates, sol.levels, 0, hold)) continue;
      const t = simulatePitchEnv(sol.rates, sol.levels, GATE);
      expect(
        Math.abs(t.nodes[0].timeSec - base.nodes[0].timeSec) / tPerBlock,
        `L4 dragged to ${l}`,
      ).toBeLessThanOrEqual(TWO_BLOCKS);
      if (sol.rates[0] !== rates[0]) resolved++;
    }
    expect(resolved, 'R1 had to be re-solved to hold stage 1').toBeGreaterThan(10);
  });

  it('a level-only drag pins the follower too', () => {
    // The start-level handle has no horizontal freedom, but moving it still
    // changes how far stage 1 has to travel.
    const sol = solvePitchNodeDrag(rates, levels, 3, null, pitchTargetLevel(20));
    expect(sol.rates[3], 'no time was dragged, so R4 is untouched').toBe(rates[3]);
    const t = simulatePitchEnv(sol.rates, sol.levels, GATE);
    expect(Math.abs(t.nodes[0].timeSec - base.nodes[0].timeSec) / tPerBlock).toBeLessThanOrEqual(
      TWO_BLOCKS,
    );
  });

  it('a vertical drag holds the dragged node and the one after it', () => {
    for (const stage of [0, 1, 2]) {
      const want = durs(base)[stage];
      const followerHold = durs(base)[stage + 1];
      for (let l = 5; l <= 95; l++) {
        const sol = solvePitchNodeDrag(rates, levels, stage, want, pitchTargetLevel(l));
        if (!canReach(sol.rates, sol.levels, stage, want)) continue;
        if (!canReach(sol.rates, sol.levels, stage + 1, followerHold)) continue;
        const t = simulatePitchEnv(sol.rates, sol.levels, GATE);
        expect(
          Math.abs(durs(t)[stage] - want) / tPerBlock,
          `stage ${stage} level ${l}`,
        ).toBeLessThanOrEqual(ONE_BLOCK);
        expect(
          Math.abs(endOf(t, stage + 1) - endOf(base, stage + 1)) / tPerBlock,
          `node after stage ${stage}, level ${l}`,
        ).toBeLessThanOrEqual(TWO_BLOCKS);
      }
    }
  });
});
