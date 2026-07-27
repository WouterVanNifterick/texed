// Accurate DX7 envelope simulation for visualization and editing.
//
// This replays the exact arithmetic of engine/env.ts (amplitude EG) and
// engine/pitchenv.ts (pitch EG) so the drawn curve has realistic per-stage
// times and levels that match sample output. It uses closed forms per stage
// (decay: linear in log space; attack: per-k-band; static hold: table) instead
// of stepping every 64-sample block, so it is cheap enough to run on every
// parameter edit and to scan 100 candidates per drag for the inverse mapping.
//
// A fixed 44.1 kHz reference is used internally; envelope timing in seconds is
// sample-rate independent by design (srMultiplier cancels), so this never
// depends on the mutable Env.initSr module state.

import { N } from './synth';
import { pitchEnvUnit } from './pitchenv';
import {
  ampIncAt,
  ampLevelBase,
  ampStaticAt,
  lerpAt,
  pitchIncAt,
  pitchLevelAt,
} from './env-tables';

const SR = 44100;
const SR_MUL = 1 << 24; // (44100 / 44100) * 2^24 - identity at the reference rate.

// One "doubling" of internal level is 2^24, i.e. +6.0206 dB.
const DB_PER_DOUBLING = 6.020599913279624; // 20*log10(2)
const LEVEL_OFFSET = 14; // dx7note peekVoiceStatus: amp = 2^(level/2^24 - 14).

export const DB_TOP = 6;
export const DB_FLOOR = -72;
/** Linear amplitude at DB_TOP - the top of the linear-amplitude y axis. */
export const AMP_TOP = Math.pow(2, DB_TOP / DB_PER_DOUBLING);

const JUMP_FLOOR = 1716 << 16; // attack never starts below this (avoids infinite log ramp)
const CEIL = 17 << 24; // attack decelerates toward this ceiling

/** Internal Q24 target level for an amp EG stage - mirrors env.ts advance(). */
export function ampTargetLevel(newlevel: number, outlevel: number): number {
  let actuallevel = lerpAt(ampLevelBase, newlevel) + outlevel - 4256;
  if (actuallevel < 16) actuallevel = 16;
  return Math.round(actuallevel * 65536);
}

/** Q24 internal level → dBFS (0 dB ≈ full scale). */
export function q24ToDb(levelQ24: number): number {
  return (levelQ24 / (1 << 24) - LEVEL_OFFSET) * DB_PER_DOUBLING;
}

/** Q24 internal level → linear amplitude (≈1.0 near 0 dBFS). */
export function q24ToAmp(levelQ24: number): number {
  return Math.pow(2, levelQ24 / (1 << 24) - LEVEL_OFFSET);
}

/** dBFS → Q24 internal level (inverse of q24ToDb). */
export function dbToQ24(db: number): number {
  return (db / DB_PER_DOUBLING + LEVEL_OFFSET) * (1 << 24);
}

/** Linear amplitude → Q24 internal level (inverse of q24ToAmp). */
export function ampToQ24(amp: number): number {
  return (Math.log2(Math.max(1e-9, amp)) + LEVEL_OFFSET) * (1 << 24);
}

export interface AmpEnvParams {
  rates: ArrayLike<number>; // R1..R4 raw 0-99
  levels: ArrayLike<number>; // L1..L4 raw 0-99
  outlevel: number; // combined per-op output level (dx7note-style, pre-<<16)
  rateScaling: number; // keyboard rate scaling contribution
}

export interface EnvPoint {
  timeSec: number;
  levelQ24: number;
  /** Stage this point ends (0..3). */
  stage: number;
  /** False if this key-on node is only reached after the gate/time clamp. */
  reached: boolean;
}

export interface EnvTrace {
  /** Draggable nodes: L1,L2,L3 ends then the release (L4) end. */
  nodes: EnvPoint[];
  /** Dense polyline (time, level) including attack curvature and holds. */
  curve: { timeSec: number; levelQ24: number }[];
  startLevelQ24: number;
  sustainSec: number; // time stage 2 completes (untruncated)
  sustainLevelQ24: number;
  gateSec: number;
  releaseEndSec: number;
  releaseEndLevelQ24: number;
}

interface StageKin {
  target: number;
  rising: boolean;
  inc: number;
  staticSamples: number;
  isStatic: boolean;
}

/** Port of env.ts advance(): kinematics for one amp EG stage. */
function ampStageKin(ix: number, level: number, p: AmpEnvParams): StageKin {
  const newlevel = p.levels[ix];
  const target = ampTargetLevel(newlevel, p.outlevel);
  const rising = target > level;

  const shortHold = ix === 0 && newlevel < 0.5 ? 1 : 0;
  let staticSamples = 0;
  const isStatic = target === level || shortHold === 1;
  if (isStatic) {
    const staticrate = Math.min(99, p.rates[ix] + p.rateScaling);
    staticSamples = Math.round(lerpAt(ampStaticAt, staticrate, SR_MUL, shortHold));
  }

  const inc = Math.round(lerpAt(ampIncAt, p.rates[ix], SR_MUL, p.rateScaling));
  return { target, rising, inc, staticSamples, isStatic };
}

/** Number of 64-sample blocks a rising (attack) stage takes to reach target. */
function attackBlocks(startLevel: number, target: number, inc: number): number {
  let level = startLevel < JUMP_FLOOR ? JUMP_FLOOR : startLevel;
  if (level >= target) return 0;
  let blocks = 0;
  // k = ((17<<24) - level) >> 24 is constant within a level band ((16-k)<<24,
  // (17-k)<<24]; the level rises by k*inc per block. A block starting at level
  // <= bandTop uses this k, so leaving the band takes floor((bandTop-level)/
  // step)+1 blocks - matching env.ts getsample() block-for-block.
  for (let guard = 0; guard < 64; guard++) {
    const k = (CEIL - level) >> 24;
    const step = Math.imul(k, inc);
    if (step <= 0) break; // cannot progress (rate too low vs ceiling) - treat as done
    const bandTop = (17 - k) << 24;
    if (target <= bandTop) {
      blocks += Math.ceil((target - level) / step);
      break;
    }
    const b = Math.floor((bandTop - level) / step) + 1;
    level = (level + b * step) | 0;
    blocks += b;
    if (level >= target) break;
  }
  return blocks;
}

/** Blocks and end level for one amp EG stage entered at `startLevel`. */
function ampStage(
  startLevel: number,
  ix: number,
  p: AmpEnvParams,
): {
  blocks: number;
  endLevel: number;
  kin: StageKin;
} {
  const kin = ampStageKin(ix, startLevel, p);
  // A genuine timed hold only happens when the static formula yields > 0
  // samples; env.ts gates this on `if (this.staticcount)` being truthy. When it
  // rounds to 0 the engine skips the hold and does a normal one-block step.
  if (kin.staticSamples > 0) {
    // ix0/L1=0 holds at the start level (0); otherwise target === level.
    return { blocks: Math.ceil(kin.staticSamples / N), endLevel: startLevel, kin };
  }
  // Any processed non-hold stage advances the envelope in at least one block
  // (the attack floor snap can overshoot a low target and finish immediately).
  if (kin.rising) {
    return {
      blocks: Math.max(1, attackBlocks(startLevel, kin.target, kin.inc)),
      endLevel: kin.target,
      kin,
    };
  }
  return {
    blocks: Math.max(1, Math.ceil((startLevel - kin.target) / kin.inc)),
    endLevel: kin.target,
    kin,
  };
}

/** Exact level after `b` blocks within a stage entered at `startLevel`. */
function ampLevelAtBlock(startLevel: number, b: number, kin: StageKin): number {
  if (b <= 0) return startLevel;
  if (kin.staticSamples > 0) return startLevel;
  if (kin.rising) {
    let level = startLevel < JUMP_FLOOR ? JUMP_FLOOR : startLevel;
    let done = 0;
    for (let guard = 0; guard < 64 && done < b && level < kin.target; guard++) {
      const k = (CEIL - level) >> 24;
      const step = Math.imul(k, kin.inc);
      if (step <= 0) break;
      const bandTop = (17 - k) << 24;
      const bandBlocks =
        kin.target <= bandTop
          ? Math.ceil((kin.target - level) / step)
          : Math.floor((bandTop - level) / step) + 1;
      const take = Math.min(bandBlocks, b - done);
      level = (level + take * step) | 0;
      done += take;
    }
    return level > kin.target ? kin.target : level;
  }
  const level = (startLevel - b * kin.inc) | 0;
  return level < kin.target ? kin.target : level;
}

const CURVE_PTS = 18; // samples per non-trivial segment (enough for linear-amp curvature)

function sampleSegment(
  startLevel: number,
  kin: StageKin,
  blocks: number,
  tStart: number,
  out: { timeSec: number; levelQ24: number }[],
): void {
  const tPerBlock = N / SR;
  if (kin.staticSamples > 0 || blocks <= 1) {
    out.push({
      timeSec: tStart + blocks * tPerBlock,
      levelQ24: ampLevelAtBlock(startLevel, blocks, kin),
    });
    return;
  }
  for (let i = 1; i <= CURVE_PTS; i++) {
    const b = Math.round((i / CURVE_PTS) * blocks);
    out.push({ timeSec: tStart + b * tPerBlock, levelQ24: ampLevelAtBlock(startLevel, b, kin) });
  }
}

/** Cumulative end times (sec) of the three key-on stages, before gate is known. */
export function ampStageTimes(p: AmpEnvParams): [number, number, number] {
  const tPerBlock = N / SR;
  let level = 0;
  let t = 0;
  const out: number[] = [];
  for (let ix = 0; ix < 3; ix++) {
    const s = ampStage(level, ix, p);
    t += s.blocks * tPerBlock;
    level = s.endLevel;
    out.push(t);
  }
  return [out[0], out[1], out[2]];
}

/** Level (Q24) at the start of stage `ix` given the current params. */
function ampStartLevelForStage(p: AmpEnvParams, ix: number): number {
  let level = 0;
  for (let i = 0; i < ix; i++) level = ampStage(level, i, p).endLevel;
  return level;
}

/**
 * Full amplitude envelope trace: key-on (stages 0-2), sustain hold until
 * `gateSec`, then release (stage 3) to L4. Times/levels mirror the engine.
 */
export function simulateAmpEnv(p: AmpEnvParams, gateSec: number): EnvTrace {
  const tPerBlock = N / SR;
  const curve: { timeSec: number; levelQ24: number }[] = [];
  const nodes: EnvPoint[] = [];

  const startLevel = 0;
  curve.push({ timeSec: 0, levelQ24: startLevel });

  let level = startLevel;
  let t = 0;
  const stageEndT: number[] = [];
  const stageEndLevel: number[] = [];
  const stageStartLevel: number[] = [];
  const stageKin: StageKin[] = [];
  const stageBlocks: number[] = [];
  for (let ix = 0; ix < 3; ix++) {
    const s = ampStage(level, ix, p);
    stageStartLevel.push(level);
    stageKin.push(s.kin);
    stageBlocks.push(s.blocks);
    sampleSegment(level, s.kin, s.blocks, t, curve);
    t += s.blocks * tPerBlock;
    level = s.endLevel;
    stageEndT.push(t);
    stageEndLevel.push(level);
  }
  const sustainSec = t;
  const sustainLevel = level;

  // Find the level at the gate. With the shared gate (>= every envelope's own
  // sustain time) this is normally the sustain level; only a time-clamped slow
  // envelope releases mid-stage.
  let gateLevel = sustainLevel;
  const gateBeforeSustain = gateSec < sustainSec;
  if (gateBeforeSustain) {
    for (let ix = 0; ix < 3; ix++) {
      const t0 = ix === 0 ? 0 : stageEndT[ix - 1];
      if (gateSec <= stageEndT[ix]) {
        const b = Math.round((gateSec - t0) / tPerBlock);
        gateLevel = ampLevelAtBlock(stageStartLevel[ix], b, stageKin[ix]);
        break;
      }
    }
  }

  // Key-on nodes (L1, L2, L3 ends).
  for (let ix = 0; ix < 3; ix++) {
    nodes.push({
      timeSec: stageEndT[ix],
      levelQ24: stageEndLevel[ix],
      stage: ix,
      reached: !gateBeforeSustain || gateSec >= stageEndT[ix],
    });
  }

  // Hold at the gate level from sustain to gate (flat), then release.
  const gateT = Math.max(gateSec, sustainSec);
  if (!gateBeforeSustain) {
    curve.push({ timeSec: gateT, levelQ24: gateLevel });
  } else {
    curve.push({ timeSec: gateSec, levelQ24: gateLevel });
  }

  const rel = ampStage(gateLevel, 3, p);
  const relStartT = gateBeforeSustain ? gateSec : gateT;
  sampleSegment(gateLevel, rel.kin, rel.blocks, relStartT, curve);
  const releaseEndSec = relStartT + rel.blocks * tPerBlock;
  const releaseEndLevel = rel.endLevel;

  nodes.push({ timeSec: releaseEndSec, levelQ24: releaseEndLevel, stage: 3, reached: true });

  return {
    nodes,
    curve,
    startLevelQ24: startLevel,
    sustainSec,
    sustainLevelQ24: sustainLevel,
    gateSec: relStartT,
    releaseEndSec,
    releaseEndLevelQ24: releaseEndLevel,
  };
}

// ---- Pitch EG (linear in Q24-octaves) --------------------------------------

// Read per call, not cached: the accuracy mode can change at runtime and the
// drawn curve has to follow the engine.
const pitchUnit = () => pitchEnvUnit(SR);

/** Q24 per-octave target for a pitch EG level param. */
export function pitchTargetLevel(newlevel: number): number {
  return Math.round(lerpAt(pitchLevelAt, newlevel));
}

function pitchStageBlocks(startLevel: number, target: number, rawRate: number): number {
  const inc = Math.round(lerpAt(pitchIncAt, rawRate, pitchUnit()));
  if (inc <= 0) return 0;
  return Math.ceil(Math.abs(target - startLevel) / inc);
}

export function pitchStageTimes(
  rates: ArrayLike<number>,
  levels: ArrayLike<number>,
): [number, number, number] {
  const tPerBlock = N / SR;
  let level = pitchTargetLevel(levels[3]);
  let t = 0;
  const out: number[] = [];
  for (let ix = 0; ix < 3; ix++) {
    const target = pitchTargetLevel(levels[ix]);
    t += pitchStageBlocks(level, target, rates[ix]) * tPerBlock;
    level = target;
    out.push(t);
  }
  return [out[0], out[1], out[2]];
}

export function simulatePitchEnv(
  rates: ArrayLike<number>,
  levels: ArrayLike<number>,
  gateSec: number,
): EnvTrace {
  const tPerBlock = N / SR;
  const curve: { timeSec: number; levelQ24: number }[] = [];
  const nodes: EnvPoint[] = [];

  const startLevel = pitchTargetLevel(levels[3]);
  curve.push({ timeSec: 0, levelQ24: startLevel });

  let level = startLevel;
  let t = 0;
  const stageEndT: number[] = [];
  const stageEndLevel: number[] = [];
  for (let ix = 0; ix < 3; ix++) {
    const target = pitchTargetLevel(levels[ix]);
    const blocks = pitchStageBlocks(level, target, rates[ix]);
    t += blocks * tPerBlock;
    level = target;
    curve.push({ timeSec: t, levelQ24: level });
    stageEndT.push(t);
    stageEndLevel.push(level);
  }
  const sustainSec = t;
  const sustainLevel = level;

  for (let ix = 0; ix < 3; ix++) {
    nodes.push({
      timeSec: stageEndT[ix],
      levelQ24: stageEndLevel[ix],
      stage: ix,
      reached: gateSec >= stageEndT[ix] || gateSec >= sustainSec,
    });
  }

  const gateT = Math.max(gateSec, sustainSec);
  curve.push({ timeSec: gateT, levelQ24: sustainLevel });

  const relTarget = pitchTargetLevel(levels[3]);
  const relBlocks = pitchStageBlocks(sustainLevel, relTarget, rates[3]);
  const releaseEndSec = gateT + relBlocks * tPerBlock;
  curve.push({ timeSec: releaseEndSec, levelQ24: relTarget });
  nodes.push({ timeSec: releaseEndSec, levelQ24: relTarget, stage: 3, reached: true });

  return {
    nodes,
    curve,
    startLevelQ24: startLevel,
    sustainSec,
    sustainLevelQ24: sustainLevel,
    gateSec: gateT,
    releaseEndSec,
    releaseEndLevelQ24: relTarget,
  };
}

// ---- Inverse mappings (drag a node → parameter value) ----------------------

/** Duration (sec) of amp stage `ix` for a candidate raw rate, fixed start level. */
function ampStageDurationSec(
  startLevel: number,
  ix: number,
  rawRate: number,
  p: AmpEnvParams,
): number {
  const probe: AmpEnvParams = {
    rates: [p.rates[0], p.rates[1], p.rates[2], p.rates[3]],
    levels: p.levels,
    outlevel: p.outlevel,
    rateScaling: p.rateScaling,
  };
  (probe.rates as number[])[ix] = rawRate;
  return (ampStage(startLevel, ix, probe).blocks * N) / SR;
}

const logT = (sec: number) => Math.log2(1 + Math.max(0, sec) / 0.05);

// Halvings of the 0..99 range when inverting. 22 places a rate within 2.4e-5,
// which is what it takes to resolve individual block counts on a stage of a
// second or two - there the duration plateaus are only ~1e-3 of a rate step
// wide. Three bisections at this depth still cost fewer evaluations than the
// flat 0..99 scan this replaced.
const BISECT = 22;

/**
 * Fractional param (0-99) at which the monotone non-decreasing map `f` reaches
 * `y`, by bracketing the two integers around it and interpolating between them.
 * Exact for a value the integer grid can hit, and it returns 0 across the flat
 * region at the bottom of the range rather than somewhere inside it.
 */
function invertMonotone(f: (i: number) => number, y: number): number {
  if (y <= f(0)) return 0;
  if (y >= f(99)) return 99;
  // Narrow to f(lo) < y <= f(hi), hi === lo + 1. Bracketing a strict step (not
  // just any step) means the two are never equal, so there is no flat-segment
  // special case, and a y sitting on a plateau resolves to the plateau's foot -
  // the lowest param that produces it, which is what makes the round trip
  // through a strictly monotone table exact.
  let lo = 0;
  let hi = 99;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f(mid) < y) lo = mid;
    else hi = mid;
  }
  const a = f(lo);
  return lo + (y - a) / (f(hi) - a);
}

/** Widest r around `at` for which `dur` still yields `blocks`, toward `bound`. */
function plateauEdge(
  dur: (r: number) => number,
  blocks: number,
  at: number,
  bound: number,
): number {
  if (dur(bound) === blocks) return bound;
  let inside = at;
  let outside = bound;
  for (let i = 0; i < BISECT; i++) {
    const mid = (inside + outside) / 2;
    if (dur(mid) === blocks) inside = mid;
    else outside = mid;
  }
  return inside;
}

/**
 * Fractional rate (0-99) whose stage duration best matches `targetSec`.
 *
 * Duration is a non-increasing staircase in the rate - a stage always lasts a
 * whole number of 64-sample blocks - so a whole interval of rates produces the
 * block count we want. Bisect for it, pick between the two neighbouring counts
 * in log-time (what the eye sees on a log axis), then return the middle of the
 * winning interval, which keeps the node still while the cursor moves within
 * one block. `currentRate` is returned when the rate cannot affect this stage
 * at all, e.g. a pitch EG stage whose start and target levels are equal.
 */
function rateForDuration(
  dur: (r: number) => number,
  targetSec: number,
  currentRate: number,
): number {
  const slowest = dur(0);
  const fastest = dur(99);
  if (slowest === fastest) return currentRate;
  if (targetSec >= slowest) return 0;
  if (targetSec <= fastest) return 99;

  let lo = 0;
  let hi = 99;
  for (let i = 0; i < BISECT; i++) {
    const mid = (lo + hi) / 2;
    if (dur(mid) >= targetSec) lo = mid;
    else hi = mid;
  }
  const want = logT(targetSec);
  const err = (r: number) => Math.abs(logT(dur(r)) - want);
  const best = err(lo) <= err(hi) ? lo : hi;
  const blocks = dur(best);
  return (plateauEdge(dur, blocks, best, 0) + plateauEdge(dur, blocks, best, 99)) / 2;
}

export function rateForStageDuration(
  p: AmpEnvParams,
  ix: number,
  targetSec: number,
  currentRate: number,
): number {
  const startLevel = ampStartLevelForStage(p, ix);
  return rateForDuration((r) => ampStageDurationSec(startLevel, ix, r, p), targetSec, currentRate);
}

/** Duration (sec) amp stage `ix` actually takes with the given params. */
function ampStageDurSec(p: AmpEnvParams, ix: number): number {
  return (ampStage(ampStartLevelForStage(p, ix), ix, p).blocks * N) / SR;
}

/** Duration (sec) pitch stage `ix` actually takes with the given params. */
function pitchStageDurSec(rates: ArrayLike<number>, levels: ArrayLike<number>, ix: number): number {
  // Stage 0 starts from L4 (the pitch EG's resting level); every later stage
  // starts where its predecessor landed.
  const start = pitchTargetLevel(ix === 0 ? levels[3] : levels[ix - 1]);
  return (pitchStageBlocks(start, pitchTargetLevel(levels[ix]), rates[ix]) * N) / SR;
}

export function pitchRateForStageDuration(
  levels: ArrayLike<number>,
  ix: number,
  targetSec: number,
  currentRate: number,
): number {
  // Start level for stage ix (independent of the stage's own rate).
  let startLevel = pitchTargetLevel(levels[3]);
  for (let i = 0; i < ix; i++) startLevel = pitchTargetLevel(levels[i]);
  const target = pitchTargetLevel(levels[ix]);
  return rateForDuration(
    (r) => (pitchStageBlocks(startLevel, target, r) * N) / SR,
    targetSec,
    currentRate,
  );
}

/** Level param (0-99), possibly fractional, whose amp target is `desiredQ24`. */
export function levelForTarget(desiredQ24: number, outlevel: number): number {
  return invertMonotone((l) => ampTargetLevel(l, outlevel), desiredQ24);
}

/** Pitch level param (0-99), possibly fractional, whose target is `desiredQ24`. */
export function pitchLevelForTarget(desiredQ24: number): number {
  return invertMonotone(pitchTargetLevel, desiredQ24);
}

// ---- Node drag (2D) --------------------------------------------------------

export interface EnvDragSolution {
  rates: number[];
  levels: number[];
}

/**
 * Which stage's timing a level change at `stage` disturbs without being the
 * dragged stage itself. Changing L(s) moves the *start* level of the next stage
 * while leaving its end level alone, so the damage stops there - one rate to
 * re-solve, never a cascade. The pitch EG wraps: its L4 is both the release
 * target and the resting level stage 0 departs from.
 */
function followerStage(stage: number, kind: 'amp' | 'pitch'): number {
  if (stage < 3) return stage + 1;
  return kind === 'pitch' ? 0 : -1;
}

/**
 * Amp EG params after dragging node `stage` to (`desiredSec`, `desiredLevelQ24`).
 * `base` must be the parameters as they were when the gesture started, so the
 * result is a pure function of the cursor position and per-event block-rounding
 * errors cannot accumulate over a drag. `desiredSec` is the wanted duration of
 * the stage (not an absolute time); null drags the level only.
 *
 * Two things happen beyond the obvious inverse mappings. The rate is solved
 * against the *new* level, because a stage's length depends on the distance it
 * has to travel - solving against the old one leaves the node lagging the cursor
 * by however far it moved vertically this event. And the following stage's rate
 * is re-solved to restore its original duration, so a purely vertical drag
 * leaves every later node where it was, while a horizontal drag still carries
 * them along with it.
 */
export function solveAmpNodeDrag(
  base: AmpEnvParams,
  stage: number,
  desiredSec: number | null,
  desiredLevelQ24: number,
): EnvDragSolution {
  const rates = [base.rates[0], base.rates[1], base.rates[2], base.rates[3]];
  const levels = [base.levels[0], base.levels[1], base.levels[2], base.levels[3]];
  // Reads `rates`/`levels` live, so each solve below sees the edits before it.
  const probe: AmpEnvParams = {
    rates,
    levels,
    outlevel: base.outlevel,
    rateScaling: base.rateScaling,
  };

  const follower = followerStage(stage, 'amp');
  const holdSec = follower >= 0 ? ampStageDurSec(base, follower) : 0;

  levels[stage] = levelForTarget(desiredLevelQ24, base.outlevel);
  if (desiredSec !== null) {
    rates[stage] = rateForStageDuration(probe, stage, desiredSec, base.rates[stage]);
  }
  if (follower >= 0) {
    rates[follower] = rateForStageDuration(probe, follower, holdSec, base.rates[follower]);
  }
  return { rates, levels };
}

/** `solveAmpNodeDrag` for the pitch EG, which has no output-level scaling. */
export function solvePitchNodeDrag(
  baseRates: ArrayLike<number>,
  baseLevels: ArrayLike<number>,
  stage: number,
  desiredSec: number | null,
  desiredLevelQ24: number,
): EnvDragSolution {
  const rates = [baseRates[0], baseRates[1], baseRates[2], baseRates[3]];
  const levels = [baseLevels[0], baseLevels[1], baseLevels[2], baseLevels[3]];

  const follower = followerStage(stage, 'pitch');
  const holdSec = pitchStageDurSec(baseRates, baseLevels, follower);

  levels[stage] = pitchLevelForTarget(desiredLevelQ24);
  if (desiredSec !== null) {
    rates[stage] = pitchRateForStageDuration(levels, stage, desiredSec, baseRates[stage]);
  }
  rates[follower] = pitchRateForStageDuration(levels, follower, holdSec, baseRates[follower]);
  return { rates, levels };
}
