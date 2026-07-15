// Sine lookup table, ported bit-exactly from msfa/sin.cc + sin.h.
// Uses the SIN_DELTA + SIN_INLINE variant that Dexed compiles with.
//
// Phase is Q24 (a full cycle = 1 << 24). Output is Q24 in the range
// approximately [-(1<<24), (1<<24)].
//
// MkI/OPL engines (engine-mki.ts, engine-opl.ts) use separate log/exp sine
// tables; do not unify with this MSFA LUT.

const SIN_LG_N_SAMPLES = 10;
const SIN_N_SAMPLES = 1 << SIN_LG_N_SAMPLES; // 1024

const SHIFT = 24 - SIN_LG_N_SAMPLES; // 14
const LOWBITS_MASK = (1 << SHIFT) - 1;
const PHASE_INDEX_MASK = (SIN_N_SAMPLES - 1) << 1;

// Delta-encoded table: sintab[2k] = delta, sintab[2k+1] = y0. Length 2048.
const sintab = new Int32Array(SIN_N_SAMPLES << 1);
let initialized = false;

/**
 * Build the sine table using the exact integer recurrence from sin.cc.
 * The recurrence multiplies two Q30 values (products up to 2^60), so BigInt is
 * used for the intermediate math. Safe to call more than once.
 */
function init(): void {
  if (initialized) return;
  const dphase = (2 * Math.PI) / SIN_N_SAMPLES;
  const c = Math.floor(Math.cos(dphase) * (1 << 30) + 0.5);
  const s = Math.floor(Math.sin(dphase) * (1 << 30) + 0.5);
  const R = 1n << 29n;
  const bc = BigInt(c);
  const bs = BigInt(s);
  let u = 1 << 30;
  let v = 0;
  const half = SIN_N_SAMPLES / 2;
  for (let i = 0; i < half; i++) {
    sintab[(i << 1) + 1] = (v + 32) >> 6;
    sintab[((i + half) << 1) + 1] = -((v + 32) >> 6);
    const bu = BigInt(u);
    const bv = BigInt(v);
    const t = Number((bu * bs + bv * bc + R) >> 30n);
    u = Number((bu * bc - bv * bs + R) >> 30n);
    v = t;
  }
  for (let i = 0; i < SIN_N_SAMPLES - 1; i++) {
    sintab[i << 1] = sintab[(i << 1) + 3] - sintab[(i << 1) + 1];
  }
  sintab[(SIN_N_SAMPLES << 1) - 2] = -sintab[(SIN_N_SAMPLES << 1) - 1];
  initialized = true;
}

/**
 * Q24 phase in, Q24 amplitude out. Mirrors the inline SIN_DELTA lookup.
 *
 * Unlike exp2/freqlut, |dy * lowbits| stays below 2^31 here, so a plain >> is
 * exact and avoids sar64's Math.floor on the audio hot path.
 */
function lookup(phase: number): number {
  const lowbits = phase & LOWBITS_MASK;
  const phaseInt = (phase >> (SHIFT - 1)) & PHASE_INDEX_MASK;
  const dy = sintab[phaseInt];
  const y0 = sintab[phaseInt + 1];
  return y0 + ((dy * lowbits) >> SHIFT);
}

export const Sin = { init, lookup };
