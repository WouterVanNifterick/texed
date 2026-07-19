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

import { LG_N, N } from './synth';
import { sar64 } from './fixedpoint';
import { pitchenvRate, pitchenvTab } from './pitchenv';

const SR = 44100;
const SR_MUL = 1 << 24; // (44100 / 44100) * 2^24 - identity at the reference rate.

// One "doubling" of internal level is 2^24, i.e. +6.0206 dB.
const DB_PER_DOUBLING = 6.020599913279624; // 20*log10(2)
const LEVEL_OFFSET = 14; // dx7note peekVoiceStatus: amp = 2^(level/2^24 - 14).

export const DB_TOP = 6;
export const DB_FLOOR = -72;
/** Linear amplitude at DB_TOP - the top of the linear-amplitude y axis. */
export const AMP_TOP = Math.pow(2, DB_TOP / DB_PER_DOUBLING);

const levellut = [0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46];

// prettier-ignore
const statics = [
  1764000, 1764000, 1411200, 1411200, 1190700, 1014300, 992250,
  882000, 705600, 705600, 584325, 507150, 502740, 441000, 418950,
  352800, 308700, 286650, 253575, 220500, 220500, 176400, 145530,
  145530, 125685, 110250, 110250, 88200, 88200, 74970, 61740,
  61740, 55125, 48510, 44100, 37485, 31311, 30870, 27562, 27562,
  22050, 18522, 17640, 15435, 14112, 13230, 11025, 9261, 9261, 7717,
  6615, 6615, 5512, 5512, 4410, 3969, 3969, 3439, 2866, 2690, 2249,
  1984, 1896, 1808, 1411, 1367, 1234, 1146, 926, 837, 837, 705,
  573, 573, 529, 441, 441,
];

const JUMP_FLOOR = 1716 << 16; // attack never starts below this (avoids infinite log ramp)
const CEIL = 17 << 24; // attack decelerates toward this ceiling

function scaleoutlevel(outlevel: number): number {
  return outlevel >= 20 ? 28 + outlevel : levellut[outlevel];
}

/** Internal Q24 target level for an amp EG stage - mirrors env.ts advance(). */
export function ampTargetLevel(newlevel: number, outlevel: number): number {
  let actuallevel = scaleoutlevel(newlevel) >> 1;
  actuallevel = (actuallevel << 6) + outlevel - 4256;
  if (actuallevel < 16) actuallevel = 16;
  return actuallevel << 16;
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

  let qrate = (p.rates[ix] * 41) >> 6;
  qrate += p.rateScaling;
  if (qrate > 63) qrate = 63;

  let staticSamples = 0;
  const isStatic = target === level || (ix === 0 && newlevel === 0);
  if (isStatic) {
    let staticrate = p.rates[ix] + p.rateScaling;
    if (staticrate > 99) staticrate = 99;
    let sc = staticrate < 77 ? statics[staticrate] : 20 * (99 - staticrate);
    if (staticrate < 77 && ix === 0 && newlevel === 0) sc = (sc / 20) | 0;
    staticSamples = sar64(sc * SR_MUL, 24);
  }

  let inc = (4 + (qrate & 3)) << (2 + LG_N + (qrate >> 2));
  inc = sar64(inc * SR_MUL, 24);
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

const PITCH_UNIT = Math.floor((N * (1 << 24)) / (21.3 * SR) + 0.5);

/** Q24 per-octave target for a pitch EG level param. */
export function pitchTargetLevel(newlevel: number): number {
  return pitchenvTab[newlevel] << 19;
}

function pitchStageBlocks(startLevel: number, target: number, rawRate: number): number {
  const inc = pitchenvRate[rawRate] * PITCH_UNIT;
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

/**
 * Raw rate (0-99) whose amp stage `ix` duration is closest to `targetSec`.
 * Compared in log-time so the choice matches what the eye sees; ties break
 * toward `currentRate` to avoid value jumps across qrate plateaus while dragging.
 */
export function rateForStageDuration(
  p: AmpEnvParams,
  ix: number,
  targetSec: number,
  currentRate: number,
): number {
  const startLevel = ampStartLevelForStage(p, ix);
  const targetL = logT(targetSec);
  let best = currentRate;
  let bestErr = Infinity;
  for (let r = 0; r <= 99; r++) {
    const err = Math.abs(logT(ampStageDurationSec(startLevel, ix, r, p)) - targetL);
    if (
      err < bestErr - 1e-9 ||
      (Math.abs(err - bestErr) <= 1e-9 && Math.abs(r - currentRate) < Math.abs(best - currentRate))
    ) {
      bestErr = err;
      best = r;
    }
  }
  return best;
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
  const targetL = logT(targetSec);
  let best = currentRate;
  let bestErr = Infinity;
  for (let r = 0; r <= 99; r++) {
    const sec = (pitchStageBlocks(startLevel, target, r) * N) / SR;
    const err = Math.abs(logT(sec) - targetL);
    if (
      err < bestErr - 1e-9 ||
      (Math.abs(err - bestErr) <= 1e-9 && Math.abs(r - currentRate) < Math.abs(best - currentRate))
    ) {
      bestErr = err;
      best = r;
    }
  }
  return best;
}

/** Level param (0-99) whose amp target level is closest to `desiredQ24`. */
export function levelForTarget(desiredQ24: number, outlevel: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let l = 0; l <= 99; l++) {
    const err = Math.abs(ampTargetLevel(l, outlevel) - desiredQ24);
    if (err < bestErr) {
      bestErr = err;
      best = l;
    }
  }
  return best;
}

/** Pitch level param (0-99) whose target is closest to `desiredQ24`. */
export function pitchLevelForTarget(desiredQ24: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let l = 0; l <= 99; l++) {
    const err = Math.abs(pitchTargetLevel(l) - desiredQ24);
    if (err < bestErr) {
      bestErr = err;
      best = l;
    }
  }
  return best;
}
