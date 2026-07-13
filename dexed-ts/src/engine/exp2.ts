// Exp2 (log->linear gain) and Tanh tables, ported bit-exactly from
// msfa/exp2.cc + exp2.h using the EXP2_INLINE variant.

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

// --- Tanh ---

const TANH_LG_N_SAMPLES = 10;
const TANH_N_SAMPLES = 1 << TANH_LG_N_SAMPLES; // 1024

const tanhtab = new Int32Array(TANH_N_SAMPLES << 1);

function dtanh(y: number): number {
  return 1 - y * y;
}

function tanhInit(): void {
  const step = 4.0 / TANH_N_SAMPLES;
  let y = 0;
  for (let i = 0; i < TANH_N_SAMPLES; i++) {
    tanhtab[(i << 1) + 1] = Math.floor((1 << 24) * y + 0.5);
    // 4th order Runge-Kutta integration of the tanh differential equation.
    const k1 = dtanh(y);
    const k2 = dtanh(y + 0.5 * step * k1);
    const k3 = dtanh(y + 0.5 * step * k2);
    const k4 = dtanh(y + step * k3);
    const dy = (step / 6) * (k1 + k4 + 2 * (k2 + k3));
    y += dy;
  }
  for (let i = 0; i < TANH_N_SAMPLES - 1; i++) {
    tanhtab[i << 1] = tanhtab[(i << 1) + 3] - tanhtab[(i << 1) + 1];
  }
  const lasty = Math.floor((1 << 24) * y + 0.5);
  tanhtab[(TANH_N_SAMPLES << 1) - 2] = lasty - tanhtab[(TANH_N_SAMPLES << 1) - 1];
}

/** Q24 in, Q24 out. Mirrors the inline Tanh::lookup. */
function tanhLookup(x: number): number {
  const signum = x >> 31;
  x ^= signum;
  if (x >= 4 << 24) {
    if (x >= 17 << 23) {
      return signum ^ (1 << 24);
    }
    const sx = sar64(-48408812 * x, 24);
    return signum ^ ((1 << 24) - 2 * exp2Lookup(sx));
  } else {
    const SHIFT = 26 - TANH_LG_N_SAMPLES; // 16
    const lowbits = x & ((1 << SHIFT) - 1);
    const xInt = (x >> (SHIFT - 1)) & ((TANH_N_SAMPLES - 1) << 1);
    const dy = tanhtab[xInt];
    const y0 = tanhtab[xInt + 1];
    const y = y0 + sar64(dy * lowbits, SHIFT);
    return y ^ signum;
  }
}

export const Tanh = { init: tanhInit, lookup: tanhLookup };
