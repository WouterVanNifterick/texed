// Core synthesis constants, ported from msfa/synth.h
// The engine renders in fixed-size blocks of N samples.

export const LG_N = 6;
export const N = 1 << LG_N; // 64

/** Clamp helper mirroring the C++ min/max templates. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
