// Scalar math for DSP that has to render identically in this engine and in the
// C++ plugin. `Math.atan` is double precision and libm's `atanf` is not, so a
// per-sample transcendental evaluated through the standard library would put a
// floor under how well the two ports can null. Everything here is a fixed
// polynomial: both ports evaluate the same expression and agree to the limit of
// their arithmetic.
//
// Coefficient-time math (once per parameter change) still uses `Math.*`. A one
// ULP difference in a filter coefficient is far below the null threshold, and
// the C++ side keeps its coefficients in `double` for the same reason.

const ATAN_C0 = 0.9999993329;
const ATAN_C1 = -0.3332985605;
const ATAN_C2 = 0.1994653599;
const ATAN_C3 = -0.1390853351;
const ATAN_C4 = 0.0964200441;
const ATAN_C5 = -0.0559098861;
const ATAN_C6 = 0.0218612288;
const ATAN_C7 = -0.004054058;

const HALF_PI = Math.PI / 2;

/** atan(x) for |x| <= 1 via an odd minimax polynomial (max error ~4e-8). */
function atanUnit(x: number): number {
  const z = x * x;
  let p = ATAN_C7;
  p = ATAN_C6 + z * p;
  p = ATAN_C5 + z * p;
  p = ATAN_C4 + z * p;
  p = ATAN_C3 + z * p;
  p = ATAN_C2 + z * p;
  p = ATAN_C1 + z * p;
  p = ATAN_C0 + z * p;
  return x * p;
}

/**
 * Arctangent accurate to ~4e-8, which is finer than the float precision the
 * C++ port works in. Used as the ladder filter's per-sample soft clipper.
 */
export function atanApprox(x: number): number {
  if (x > 1) return HALF_PI - atanUnit(1 / x);
  if (x < -1) return -HALF_PI - atanUnit(1 / x);
  return atanUnit(x);
}

const LOG2_P0 = 1.23149591368684;
const LOG2_P1 = -4.11852516267426;
const LOG2_P2 = 6.02197014179219;
const LOG2_P3 = -3.13396450166353;

const LOG10_OF_2 = 0.3010299956639812;
const LN10 = 2.302585092994;

/**
 * The CMSIS third-order log2 approximation the compressor is built around:
 * split off the exponent, run a cubic over the [0.5, 1) mantissa. Accurate to
 * about 0.008 dB when used for level detection, which is well inside what the
 * gain smoothing hides. Kept in place of `Math.log2` so the C++ port, which has
 * the same polynomial, tracks it sample for sample.
 */
export function log2Approx(x: number): number {
  const a = Math.abs(x);
  // frexp(0) yields a zero mantissa and exponent, so the polynomial collapses
  // to its constant term rather than diverging.
  if (a === 0 || !Number.isFinite(a)) return LOG2_P3;

  let e = Math.floor(Math.log2(a)) + 1;
  let f = a * 2 ** -e;
  if (f >= 1) {
    f *= 0.5;
    e += 1;
  } else if (f < 0.5) {
    f *= 2;
    e -= 1;
  }

  let y = LOG2_P0;
  y = y * f + LOG2_P1;
  y = y * f + LOG2_P2;
  y = y * f + LOG2_P3;
  return y + e;
}

export function log10Approx(x: number): number {
  return log2Approx(x) * LOG10_OF_2;
}

/** 10^x, as exp(ln(10) * x). The C++ port must use double `exp` to match. */
export function pow10Approx(x: number): number {
  return Math.exp(LN10 * x);
}
