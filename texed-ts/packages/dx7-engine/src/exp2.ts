// Exp2 (log->linear gain) table, ported bit-exactly from msfa/exp2.cc + exp2.h
// using the EXP2_INLINE variant.

import { sar64, shiftRight32 } from './fixedpoint';

const EXP2_LG_N_SAMPLES = 10;
const EXP2_N_SAMPLES = 1 << EXP2_LG_N_SAMPLES; // 1024

// Delta-encoded: exp2tab[2k] = delta, exp2tab[2k+1] = y0. Length 2048.
const exp2tab = new Int32Array(EXP2_N_SAMPLES << 1);

function exp2Init(): void {
  const inc = Math.pow(2, 1.0 / EXP2_N_SAMPLES);
  let y = 1 << 30;
  for (let i = 0; i < EXP2_N_SAMPLES; i++) {
    exp2tab[(i << 1) + 1] = Math.floor(y + 0.5);
    y *= inc;
  }
  for (let i = 0; i < EXP2_N_SAMPLES - 1; i++) {
    exp2tab[i << 1] = exp2tab[(i << 1) + 3] - exp2tab[(i << 1) + 1];
  }
  // (1U << 31) - last y0
  exp2tab[(EXP2_N_SAMPLES << 1) - 2] = (2 ** 31 - exp2tab[(EXP2_N_SAMPLES << 1) - 1]) | 0;
}

/**
 * Q24 in, Q24 out. The `dy * lowbits` product can exceed 32 bits, so the
 * >> SHIFT step uses sar64 to preserve precision like the C++ int64 math.
 */
function exp2Lookup(x: number): number {
  const SHIFT = 24 - EXP2_LG_N_SAMPLES; // 14
  const lowbits = x & ((1 << SHIFT) - 1);
  const xInt = (x >> (SHIFT - 1)) & ((EXP2_N_SAMPLES - 1) << 1);
  const dy = exp2tab[xInt];
  const y0 = exp2tab[xInt + 1];
  const y = y0 + sar64(dy * lowbits, SHIFT);
  return shiftRight32(y, 6 - (x >> 24));
}

export const Exp2 = { init: exp2Init, lookup: exp2Lookup };
