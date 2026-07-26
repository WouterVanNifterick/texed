// The DX7 envelope lookup tables, and the integer functions built on them.
//
// These used to exist twice: once in env.ts / pitchenv.ts (the real engine) and
// once in env-sim.ts (the closed-form replay that draws the curves). Two copies
// of a bit-exact port is one copy too many - the whole point of env-sim is that
// the picture matches the sound, and that is only guaranteed if both sides do
// the arithmetic with the same code.
//
// Every function here maps an integer parameter to an integer engine quantity,
// exactly as msfa does. The sample-rate multiplier is a parameter rather than
// module state so the engine (mutable, follows the AudioContext) and env-sim
// (fixed 44.1 kHz reference) can share one implementation.

import { LG_N } from './synth';
import { sar64 } from './fixedpoint';

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

// prettier-ignore
export const pitchenvRate = [
  1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12,
  12, 13, 13, 14, 14, 15, 16, 16, 17, 18, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 30, 31, 33, 34, 36, 37, 38, 39, 41, 42, 44, 46, 47,
  49, 51, 53, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 79, 82,
  85, 88, 91, 94, 98, 102, 106, 110, 115, 120, 125, 130, 135, 141, 147,
  153, 159, 165, 171, 178, 185, 193, 202, 211, 232, 243, 254, 255,
];

// prettier-ignore
export const pitchenvTab = [
  -128, -116, -104, -95, -85, -76, -68, -61, -56, -52, -49, -46, -43,
  -41, -39, -37, -35, -33, -32, -31, -30, -29, -28, -27, -26, -25, -24,
  -23, -22, -21, -20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10,
  -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32, 33, 34, 35, 38, 40, 43, 46, 49, 53, 58, 65, 73,
  82, 92, 103, 115, 127,
];

/**
 * Piecewise-linear extension of an integer-domain function, so a parameter can
 * hold a fractional value and the envelope still moves continuously.
 *
 * `f` must be the *outermost* integer expression - every `>>`, `&` and `sar64`
 * has to happen inside it, on integer inputs. Then `lerpAt(f, i) === f(i)`
 * exactly, and a patch made of whole numbers renders bit-identically to before.
 * The early return is not an optimisation: it is what stops `f(i + 1)` reading
 * past the end of a 0..99 table when x is exactly 99.
 */
export function lerpAt(
  f: (i: number, a: number, b: number) => number,
  x: number,
  a = 0,
  b = 0,
): number {
  const i = Math.floor(x);
  if (x === i) return f(i, a, b);
  const lo = f(i, a, b);
  return lo + (x - i) * (f(i + 1, a, b) - lo);
}

export function scaleoutlevel(outlevel: number): number {
  return outlevel >= 20 ? 28 + outlevel : levellut[outlevel];
}

/** Amp EG target level before the per-operator output level is added in. */
export function ampLevelBase(newlevel: number): number {
  return (scaleoutlevel(newlevel) >> 1) << 6;
}

/** Per-block level increment for an amp EG stage at raw rate `rate`. */
export function ampIncAt(rate: number, srMul: number, rateScaling: number): number {
  let qrate = (rate * 41) >> 6;
  qrate += rateScaling;
  if (qrate > 63) qrate = 63;
  return sar64(((4 + (qrate & 3)) << (2 + LG_N + (qrate >> 2))) * srMul, 24);
}

/**
 * Length in samples of a static (no level change) amp EG stage. `staticrate` is
 * the raw rate plus rate scaling, already clamped to 99. `shortHold` is the
 * ix 0 / L1 = 0 case, which holds for a twentieth of the tabulated time.
 */
export function ampStaticAt(staticrate: number, srMul: number, shortHold: number): number {
  let sc = staticrate < 77 ? statics[staticrate] : 20 * (99 - staticrate);
  if (staticrate < 77 && shortHold) sc = (sc / 20) | 0;
  return sar64(sc * srMul, 24);
}

/** Q24-per-octave target for a pitch EG level param. */
export function pitchLevelAt(level: number): number {
  return pitchenvTab[level] << 19;
}

/** Per-block level increment for a pitch EG stage at raw rate `rate`. */
export function pitchIncAt(rate: number, unit: number): number {
  return pitchenvRate[rate] * unit;
}
