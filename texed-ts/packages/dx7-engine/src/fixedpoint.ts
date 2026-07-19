// Fixed-point helpers for bit-exact ports of the msfa integer DSP.
//
// The C++ engine uses int32_t arithmetic with 64-bit intermediate products,
// e.g. `(int32_t)(((int64_t)a * (int64_t)b) >> shift)`. JavaScript's `>>`
// operator first coerces its operand to a 32-bit int, which corrupts products
// that exceed 32 bits. These helpers reproduce the C++ semantics.

/**
 * Arithmetic right shift of a value that may be up to 53 bits wide, emulating
 * `(int64_t)value >> shift`. `Math.floor` rounds toward negative infinity,
 * which matches the arithmetic shift behaviour the engine relies on. The input
 * must be an exact integer (|value| < 2^53).
 */
export function sar64(value: number, shift: number): number {
  return Math.floor(value / pow2(shift));
}

/**
 * Signed shift with a possibly-negative count: positive shifts right,
 * negative shifts left. Reproduces `value >> n` where the C code may pass a
 * negative `n` (meaning a left shift). The result is coerced to a signed 32-bit
 * integer, matching the int32_t return type of the C++ lookups.
 */
export function shiftRight32(value: number, n: number): number {
  if (n >= 0) {
    return Math.floor(value / pow2(n)) | 0;
  }
  return (value * pow2(-n)) | 0;
}

const POW2: number[] = (() => {
  const t: number[] = [];
  for (let i = 0; i <= 62; i++) t.push(2 ** i);
  return t;
})();

/** 2^n for integer n in [0, 62], avoiding repeated Math.pow calls. */
export function pow2(n: number): number {
  return POW2[n];
}
