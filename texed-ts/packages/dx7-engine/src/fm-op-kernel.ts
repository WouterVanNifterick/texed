// FM operator kernel, ported bit-exactly from msfa/fm_op_kernel.cc
// (the non-NEON reference path). Buffers are length-N Int32Arrays; Int32Array
// stores truncate to int32 like the C++ int32_t writes.

import { LG_N, N } from './synth';
import { Sin } from './sin';
import { sar64 } from './fixedpoint';

export class FmOpParams {
  levelIn = 0; // value to be computed (from level to gain[0])
  gainOut = 0; // computed value (gain[1] to gain[0])
  freq = 0;
  phase = 0;
}

/** Basic FM operator with modulation input. */
function compute(
  output: Int32Array,
  input: Int32Array,
  phase0: number,
  freq: number,
  gain1: number,
  gain2: number,
  add: boolean,
): void {
  const dgain = (gain2 - gain1 + (N >> 1)) >> LG_N;
  let gain = gain1;
  let phase = phase0;
  if (add) {
    for (let i = 0; i < N; i++) {
      gain = (gain + dgain) | 0;
      const y = Sin.lookup((phase + input[i]) | 0);
      const y1 = sar64(y * gain, 24);
      output[i] = (output[i] + y1) | 0;
      phase = (phase + freq) | 0;
    }
  } else {
    for (let i = 0; i < N; i++) {
      gain = (gain + dgain) | 0;
      const y = Sin.lookup((phase + input[i]) | 0);
      const y1 = sar64(y * gain, 24);
      output[i] = y1;
      phase = (phase + freq) | 0;
    }
  }
}

/** Sine generator, no modulation input. */
function computePure(
  output: Int32Array,
  phase0: number,
  freq: number,
  gain1: number,
  gain2: number,
  add: boolean,
): void {
  const dgain = (gain2 - gain1 + (N >> 1)) >> LG_N;
  let gain = gain1;
  let phase = phase0;
  if (add) {
    for (let i = 0; i < N; i++) {
      gain = (gain + dgain) | 0;
      const y = Sin.lookup(phase);
      const y1 = sar64(y * gain, 24);
      output[i] = (output[i] + y1) | 0;
      phase = (phase + freq) | 0;
    }
  } else {
    for (let i = 0; i < N; i++) {
      gain = (gain + dgain) | 0;
      const y = Sin.lookup(phase);
      const y1 = sar64(y * gain, 24);
      output[i] = y1;
      phase = (phase + freq) | 0;
    }
  }
}

/** One operator with feedback. fbBuf holds [y0, y] across blocks. */
function computeFb(
  output: Int32Array,
  phase0: number,
  freq: number,
  gain1: number,
  gain2: number,
  fbBuf: Int32Array,
  fbShift: number,
  add: boolean,
): void {
  const dgain = (gain2 - gain1 + (N >> 1)) >> LG_N;
  let gain = gain1;
  let phase = phase0;
  let y0 = fbBuf[0];
  let y = fbBuf[1];
  if (add) {
    for (let i = 0; i < N; i++) {
      gain = (gain + dgain) | 0;
      const scaledFb = (y0 + y) >> (fbShift + 1);
      y0 = y;
      y = Sin.lookup((phase + scaledFb) | 0);
      y = sar64(y * gain, 24);
      output[i] = (output[i] + y) | 0;
      phase = (phase + freq) | 0;
    }
  } else {
    for (let i = 0; i < N; i++) {
      gain = (gain + dgain) | 0;
      const scaledFb = (y0 + y) >> (fbShift + 1);
      y0 = y;
      y = Sin.lookup((phase + scaledFb) | 0);
      y = sar64(y * gain, 24);
      output[i] = y;
      phase = (phase + freq) | 0;
    }
  }
  fbBuf[0] = y0;
  fbBuf[1] = y;
}

export const FmOpKernel = { compute, computePure, computeFb };
