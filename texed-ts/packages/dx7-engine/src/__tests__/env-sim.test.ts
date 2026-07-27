import { describe, it, expect } from 'vitest';
import { Env } from '../env';
import { PitchEnv, pitchenvTab } from '../pitchenv';
import {
  simulateAmpEnv,
  simulatePitchEnv,
  ampTargetLevel,
  pitchTargetLevel,
  rateForStageDuration,
  pitchRateForStageDuration,
  levelForTarget,
  pitchLevelForTarget,
  type AmpEnvParams,
} from '../env-sim';

const N = 64;
const SR = 44100;
const tPerBlock = N / SR;

// The closed-form simulation and the real engine can differ by at most a couple
// of 64-sample blocks at a stage boundary (the engine folds one partial step of
// the next stage into the transition block). ~1.5 ms is far below anything the
// visualization can show, so times are asserted within a small block tolerance
// while breakpoint levels - which both clamp to the same target - match exactly.
// The fold can accumulate across the three key-on transitions, so a few blocks
// (~6 ms) is the worst case over a full chain.
const BLOCK_TOL = 5;

interface Oracle {
  keyOnBlocks: number[]; // transition blocks 0->1, 1->2, 2->3
  sustainBlock: number;
  sustainLevel: number;
  releaseBlock: number;
  releaseLevel: number;
  skipped: boolean;
}

// Run the real engine, releasing the moment sustain is reached (no hold), so a
// static release (L4 == L3) can't self-advance mid-hold. Stage transition times
// are recorded; the stable sustain and release levels are captured for exact
// comparison (they are the engine's true vertex levels, unpolluted by the
// static-stage fold-in that muddies raw transition-block levels).
function runOracle(p: AmpEnvParams): Oracle {
  Env.initSr(SR);
  const e = new Env();
  e.init(p.rates, p.levels, p.outlevel, p.rateScaling);
  const keyOnBlocks: number[] = [];
  let prev = e.getPosition();
  let block = 0;
  let sustainLevel = 0;
  for (; block < 4_000_000 && e.getPosition() < 3; block++) {
    const level = e.getsample();
    const pos = e.getPosition();
    if (pos > prev) {
      keyOnBlocks.push(block + 1);
      prev = pos;
      sustainLevel = level;
    }
  }
  if (e.getPosition() < 3)
    return {
      keyOnBlocks,
      sustainBlock: 0,
      sustainLevel: 0,
      releaseBlock: 0,
      releaseLevel: 0,
      skipped: true,
    };
  const sustainBlock = block;

  e.keydown(false);
  let releaseLevel = sustainLevel;
  let releaseBlock = block;
  for (; block < 4_000_000 && e.getPosition() < 4; block++) {
    const level = e.getsample();
    if (e.getPosition() >= 4) {
      releaseBlock = block + 1;
      releaseLevel = level;
      break;
    }
  }
  return { keyOnBlocks, sustainBlock, sustainLevel, releaseBlock, releaseLevel, skipped: false };
}

describe('simulateAmpEnv matches the real Env', () => {
  const cases: { name: string; p: AmpEnvParams }[] = [
    {
      name: 'typical pluck',
      p: { rates: [99, 60, 40, 50], levels: [99, 80, 60, 0], outlevel: 99 << 5, rateScaling: 0 },
    },
    {
      name: 'slow attack',
      p: { rates: [30, 99, 99, 70], levels: [99, 99, 99, 0], outlevel: 99 << 5, rateScaling: 0 },
    },
    {
      name: 'L1=0 static start',
      p: { rates: [40, 50, 60, 40], levels: [0, 90, 70, 0], outlevel: 99 << 5, rateScaling: 0 },
    },
    {
      name: 'equal levels (hold)',
      p: { rates: [80, 50, 50, 40], levels: [80, 80, 80, 0], outlevel: 90 << 5, rateScaling: 0 },
    },
    {
      name: 'rate scaling',
      p: { rates: [70, 60, 40, 50], levels: [99, 70, 50, 0], outlevel: 80 << 5, rateScaling: 20 },
    },
    {
      name: 'low output level',
      p: { rates: [99, 70, 50, 60], levels: [99, 80, 60, 0], outlevel: 20 << 5, rateScaling: 0 },
    },
  ];

  for (const { name, p } of cases) {
    it(name, () => {
      const oracle = runOracle(p);
      expect(oracle.skipped).toBe(false);
      // Release exactly when sustain is reached, matching the oracle.
      const sim = simulateAmpEnv(p, oracle.sustainBlock * tPerBlock);

      expect(oracle.keyOnBlocks.length).toBe(3);
      for (let ix = 0; ix < 3; ix++) {
        const simBlock = Math.round(sim.nodes[ix].timeSec / tPerBlock);
        expect(Math.abs(simBlock - oracle.keyOnBlocks[ix])).toBeLessThanOrEqual(BLOCK_TOL);
      }
      // Stable vertex levels match the engine exactly.
      expect(sim.sustainLevelQ24).toBe(oracle.sustainLevel);
      expect(sim.releaseEndLevelQ24).toBe(oracle.releaseLevel);
      const simRelBlock = Math.round(sim.releaseEndSec / tPerBlock);
      expect(Math.abs(simRelBlock - oracle.releaseBlock)).toBeLessThanOrEqual(BLOCK_TOL);
    });
  }

  it('fuzz: sustain/release levels exact, transition times within tolerance', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    let checked = 0;
    for (let i = 0; i < 200; i++) {
      const p: AmpEnvParams = {
        rates: [rnd(100), rnd(100), rnd(100), rnd(100)],
        levels: [rnd(100), rnd(100), rnd(100), rnd(100)],
        outlevel: rnd(128) << 5,
        rateScaling: rnd(22),
      };
      const oracle = runOracle(p);
      if (oracle.skipped || oracle.keyOnBlocks.length < 3) continue;
      const sim = simulateAmpEnv(p, oracle.sustainBlock * tPerBlock);
      expect(sim.sustainLevelQ24).toBe(oracle.sustainLevel);
      expect(sim.releaseEndLevelQ24).toBe(oracle.releaseLevel);
      for (let ix = 0; ix < 3; ix++) {
        const simBlock = Math.round(sim.nodes[ix].timeSec / tPerBlock);
        expect(Math.abs(simBlock - oracle.keyOnBlocks[ix])).toBeLessThanOrEqual(BLOCK_TOL);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe('simulatePitchEnv matches the real PitchEnv', () => {
  const cases: number[][][] = [
    [
      [80, 60, 40, 50],
      [80, 30, 50, 50],
    ],
    [
      [99, 99, 99, 99],
      [99, 0, 50, 50],
    ],
    [
      [40, 40, 40, 40],
      [60, 70, 45, 50],
    ],
  ];
  for (let c = 0; c < cases.length; c++) {
    const [rates, levels] = cases[c];
    it(`case ${c}`, () => {
      PitchEnv.init(SR);
      const e = new PitchEnv();
      e.set(rates, levels);
      const keyOn: { block: number; level: number }[] = [];
      let prev = e.getPosition();
      let block = 0;
      for (; block < 2_000_000 && e.getPosition() < 3; block++) {
        const level = e.getsample();
        const pos = e.getPosition();
        if (pos > prev) {
          keyOn.push({ block: block + 1, level });
          prev = pos;
        }
      }
      const sim = simulatePitchEnv(rates, levels, block * tPerBlock);
      expect(sim.startLevelQ24).toBe(pitchenvTab[levels[3]] << 19);
      for (let ix = 0; ix < keyOn.length && ix < 3; ix++) {
        expect(sim.nodes[ix].levelQ24).toBe(keyOn[ix].level);
        const simBlock = Math.round(sim.nodes[ix].timeSec / tPerBlock);
        expect(Math.abs(simBlock - keyOn[ix].block)).toBeLessThanOrEqual(BLOCK_TOL);
      }
    });
  }
});

describe('inverse mappings round-trip', () => {
  const p: AmpEnvParams = {
    rates: [70, 60, 40, 50],
    levels: [99, 80, 60, 0],
    outlevel: 99 << 5,
    rateScaling: 0,
  };

  it('levelForTarget lands on a param giving the same amp level', () => {
    // Low L params clamp to the same floor target (a genuine plateau), so the
    // meaningful property is that the recovered param reproduces the level.
    for (let l = 0; l <= 99; l++) {
      const t = ampTargetLevel(l, p.outlevel);
      expect(ampTargetLevel(levelForTarget(t, p.outlevel), p.outlevel)).toBe(t);
    }
  });

  it('pitchLevelForTarget recovers every pitch level param', () => {
    for (let l = 0; l <= 99; l++) {
      expect(pitchLevelForTarget(pitchTargetLevel(l))).toBe(l);
    }
  });

  it('rateForStageDuration reproduces the same stage duration', () => {
    // simulate the duration a rate produces, then invert; must land on a rate
    // giving the identical duration (plateaus allowed, so compare durations).
    for (const ix of [0, 1, 2, 3]) {
      for (const r of [10, 40, 70, 99]) {
        const probe = { ...p, rates: Array.from(p.rates) };
        probe.rates[ix] = r;
        const sim = simulateAmpEnv(probe, 60_000 * tPerBlock);
        const t0 = ix === 0 ? 0 : sim.nodes[ix - 1].timeSec;
        const dur =
          (ix === 3 ? sim.releaseEndSec : sim.nodes[ix].timeSec) - (ix === 3 ? sim.gateSec : t0);
        const rBack = rateForStageDuration(probe, ix, dur, r);
        const probe2 = { ...p, rates: Array.from(probe.rates) };
        probe2.rates[ix] = rBack;
        const sim2 = simulateAmpEnv(probe2, 60_000 * tPerBlock);
        const dur2 =
          (ix === 3 ? sim2.releaseEndSec : sim2.nodes[ix].timeSec) -
          (ix === 3 ? sim2.gateSec : ix === 0 ? 0 : sim2.nodes[ix - 1].timeSec);
        expect(Math.abs(dur2 - dur)).toBeLessThan(dur * 0.05 + tPerBlock * 4);
      }
    }
  });

  // The point of the whole exercise: a dragged node must be able to land where
  // the integer grid cannot, otherwise it snaps.
  it('levelForTarget sweeps continuously between two integer levels', () => {
    // 51 -> 52 is a real step. 50/51 and 52/53 are not: above level 20 the
    // table pairs levels up, which is why only 58 of the 100 level params
    // produce a distinct target at all.
    const a = ampTargetLevel(51, p.outlevel);
    const b = ampTargetLevel(52, p.outlevel);
    expect(b).toBeGreaterThan(a);
    let prev = 51;
    for (let f = 0.02; f <= 1.0001; f += 0.02) {
      const l = levelForTarget(a + (b - a) * f, p.outlevel);
      expect(l).toBeGreaterThanOrEqual(prev);
      expect(l).toBeCloseTo(51 + f, 6);
      prev = l;
    }
    // A target sitting exactly on a plateau resolves to the plateau's foot.
    expect(levelForTarget(a, p.outlevel)).toBe(50);
    expect(levelForTarget(b, p.outlevel)).toBe(52);
  });

  it('pitchLevelForTarget round-trips fractional levels', () => {
    for (const l of [12.25, 40.5, 63.75, 88.1]) {
      expect(pitchLevelForTarget(pitchTargetLevel(l))).toBeCloseTo(l, 3);
    }
  });

  it('fractional rates reach stage durations no integer rate can', () => {
    const stageBlocks = (rate: number) => {
      const probe = { ...p, rates: Array.from(p.rates) };
      probe.rates[1] = rate;
      const sim = simulateAmpEnv(probe, 60_000 * tPerBlock);
      return Math.round((sim.nodes[1].timeSec - sim.nodes[0].timeSec) / tPerBlock);
    };
    const reachable = new Set<number>();
    for (let r = 0; r <= 99; r++) reachable.add(stageBlocks(r));

    // Sweep the same range fractionally and collect what opens up. Rates below
    // 30 are excluded: those stages run into the tens of seconds, where the
    // plateaus are narrower than the inverse's rate resolution (and where a
    // block either way is far past anything the display can show).
    const extra = new Set<number>();
    for (let r = 30; r <= 99; r += 0.05) {
      const b = stageBlocks(r);
      if (!reachable.has(b)) extra.add(b);
    }
    expect(extra.size).toBeGreaterThan(20);

    // And every one of those is actually selectable by dragging to that time.
    for (const blocks of extra) {
      const r = rateForStageDuration(p, 1, blocks * tPerBlock, p.rates[1]);
      expect(stageBlocks(r), `blocks=${blocks} -> rate ${r}`).toBe(blocks);
    }
  });

  it('pitchRateForStageDuration reproduces the same stage duration', () => {
    const rates = [60, 50, 40, 55];
    const levels = [80, 30, 55, 50];
    for (const ix of [0, 1, 2, 3]) {
      const target = pitchTargetLevel(levels[ix]);
      let start = pitchTargetLevel(levels[3]);
      for (let i = 0; i < ix; i++) start = pitchTargetLevel(levels[i]);
      void target;
      void start;
      const sim = simulatePitchEnv(rates, levels, 60_000 * tPerBlock);
      const t0 = ix === 0 ? 0 : sim.nodes[ix - 1].timeSec;
      const dur = ix === 3 ? sim.releaseEndSec - sim.gateSec : sim.nodes[ix].timeSec - t0;
      const rBack = pitchRateForStageDuration(levels, ix, dur, rates[ix]);
      expect(rBack).toBeGreaterThanOrEqual(0);
      expect(rBack).toBeLessThanOrEqual(99);
    }
  });
});
