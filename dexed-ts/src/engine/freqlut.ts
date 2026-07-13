// Frequency -> phase-delta lookup, ported bit-exactly from msfa/freqlut.cc.
// logfreq is Q24 where 1.0 (1 << 24) == one octave. Sample-rate dependent.

import { sar64, shiftRight32 } from './fixedpoint';

const LG_N_SAMPLES = 10;
const N_SAMPLES = 1 << LG_N_SAMPLES; // 1024
const SAMPLE_SHIFT = 24 - LG_N_SAMPLES; // 14
const MAX_LOGFREQ_INT = 20;

const lut = new Int32Array(N_SAMPLES + 1);

function init(sampleRate: number): void {
  // (1 << 44) / sample_rate, then geometric steps of 2^(1/1024).
  let y = 2 ** (24 + MAX_LOGFREQ_INT) / sampleRate;
  const inc = Math.pow(2, 1.0 / N_SAMPLES);
  for (let i = 0; i < N_SAMPLES + 1; i++) {
    lut[i] = Math.floor(y + 0.5);
    y *= inc;
  }
}

/**
 * Q24 log-frequency in, phase increment per sample out. The
 * `(y1 - y0) * lowbits` product can exceed 32 bits, so sar64 is used.
 */
function lookup(logfreq: number): number {
  const ix = (logfreq & 0xffffff) >> SAMPLE_SHIFT;
  const y0 = lut[ix];
  const y1 = lut[ix + 1];
  const lowbits = logfreq & ((1 << SAMPLE_SHIFT) - 1);
  const y = y0 + sar64((y1 - y0) * lowbits, SAMPLE_SHIFT);
  const hibits = logfreq >> 24;
  return shiftRight32(y, MAX_LOGFREQ_INT - hibits);
}

export const Freqlut = { init, lookup };
