// Mark I engine, ported bit-exactly from EngineMkI.cpp.
// Extends FmCore, overriding render with DX7 Mark I sine shaping and the
// special multi-operator feedback paths for algorithms 4 and 6.

import { LG_N, N } from './synth';
import { FmCore, algorithms } from './fm-core';
import type { FmOpParams } from './fm-op-kernel';

const NEGATIVE_BIT = 0x8000;
const ENV_BITDEPTH = 14;
const ENV_MAX = 1 << ENV_BITDEPTH; // 16384

const SINLOG_BITDEPTH = 10;
const SINLOG_TABLESIZE = 1 << SINLOG_BITDEPTH; // 1024
const sinLogTable = new Uint16Array(SINLOG_TABLESIZE);

const SINEXP_BITDEPTH = 10;
const SINEXP_TABLESIZE = 1 << SINEXP_BITDEPTH; // 1024
const sinExpTable = new Uint16Array(SINEXP_TABLESIZE);

(function initTables() {
  let bitReso = SINLOG_TABLESIZE;
  for (let i = 0; i < SINLOG_TABLESIZE; i++) {
    const x1 = Math.sin(((0.5 + i) / bitReso) * (Math.PI / 2.0));
    sinLogTable[i] = Math.round(-1024 * Math.log2(x1));
  }
  bitReso = SINEXP_TABLESIZE;
  for (let i = 0; i < SINEXP_TABLESIZE; i++) {
    const x1 = (Math.pow(2, i / bitReso) - 1) * 4096;
    sinExpTable[i] = Math.round(x1);
  }
})();

function sinLog(phi: number): number {
  const SINLOG_TABLEFILTER = SINLOG_TABLESIZE - 1;
  const index = phi & SINLOG_TABLEFILTER;
  switch (phi & (SINLOG_TABLESIZE * 3)) {
    case 0:
      return sinLogTable[index];
    case SINLOG_TABLESIZE:
      return sinLogTable[index ^ SINLOG_TABLEFILTER];
    case SINLOG_TABLESIZE * 2:
      return sinLogTable[index] | NEGATIVE_BIT;
    default:
      return sinLogTable[index ^ SINLOG_TABLEFILTER] | NEGATIVE_BIT;
  }
}

function mkiSin(phase: number, env: number): number {
  let expVal = (sinLog(phase >> (22 - SINLOG_BITDEPTH)) + env) & 0xffff;
  const isSigned = expVal & NEGATIVE_BIT;
  expVal &= ~NEGATIVE_BIT & 0xffff;
  const SINEXP_FILTER = 0x3ff;
  let result = 4096 + sinExpTable[(expVal & SINEXP_FILTER) ^ SINEXP_FILTER];
  result = result >>> (expVal >> 10);
  if (isSigned) {
    return (-result - 1) << 13;
  }
  return result << 13;
}

export class EngineMkI extends FmCore {
  private compute(
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
    for (let i = 0; i < N; i++) {
      gain = (gain + dgain) | 0;
      const y = mkiSin((phase + input[i]) | 0, gain);
      output[i] = add ? (y + output[i]) | 0 : y;
      phase = (phase + freq) | 0;
    }
  }

  private computePure(
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
    for (let i = 0; i < N; i++) {
      gain = (gain + dgain) | 0;
      const y = mkiSin(phase, gain);
      output[i] = add ? (y + output[i]) | 0 : y;
      phase = (phase + freq) | 0;
    }
  }

  private computeFb(
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
    for (let i = 0; i < N; i++) {
      gain = (gain + dgain) | 0;
      const scaledFb = (y0 + y) >> (fbShift + 1);
      y0 = y;
      y = mkiSin((phase + scaledFb) | 0, gain);
      output[i] = add ? (y + output[i]) | 0 : y;
      phase = (phase + freq) | 0;
    }
    fbBuf[0] = y0;
    fbBuf[1] = y;
  }

  // Exclusively used for ALGO 6 with feedback.
  private computeFb2(
    output: Int32Array,
    parms: FmOpParams[],
    gain01: number,
    gain02: number,
    fbBuf: Int32Array,
    fbShift: number,
  ): void {
    const dgain = [0, 0];
    const gain = [0, 0];
    const phase = [parms[0].phase, parms[1].phase];
    let y0 = fbBuf[0];
    let y = fbBuf[1];

    parms[1].gainOut = ENV_MAX - (parms[1].levelIn >> (28 - ENV_BITDEPTH));

    gain[0] = gain01;
    gain[1] = parms[1].gainOut === 0 ? ENV_MAX - 1 : parms[1].gainOut;

    dgain[0] = (gain02 - gain01 + (N >> 1)) >> LG_N;
    dgain[1] = parms[1].gainOut - (parms[1].gainOut === 0 ? ENV_MAX - 1 : parms[1].gainOut);

    for (let i = 0; i < N; i++) {
      const scaledFb = (y0 + y) >> (fbShift + 1);

      gain[0] = (gain[0] + dgain[0]) | 0;
      y0 = y;
      y = mkiSin((phase[0] + scaledFb) | 0, gain[0]);
      phase[0] = (phase[0] + parms[0].freq) | 0;

      gain[1] = (gain[1] + dgain[1]) | 0;
      y = mkiSin((phase[1] + y) | 0, gain[1]);
      phase[1] = (phase[1] + parms[1].freq) | 0;

      output[i] = y;
    }
    fbBuf[0] = y0;
    fbBuf[1] = y;
  }

  // Exclusively used for ALGO 4 with feedback.
  private computeFb3(
    output: Int32Array,
    parms: FmOpParams[],
    gain01: number,
    gain02: number,
    fbBuf: Int32Array,
    fbShift: number,
  ): void {
    const dgain = [0, 0, 0];
    const gain = [0, 0, 0];
    const phase = [parms[0].phase, parms[1].phase, parms[2].phase];
    let y0 = fbBuf[0];
    let y = fbBuf[1];

    parms[1].gainOut = ENV_MAX - (parms[1].levelIn >> (28 - ENV_BITDEPTH));
    parms[2].gainOut = ENV_MAX - (parms[2].levelIn >> (28 - ENV_BITDEPTH));

    gain[0] = gain01;
    gain[1] = parms[1].gainOut === 0 ? ENV_MAX - 1 : parms[1].gainOut;
    gain[2] = parms[2].gainOut === 0 ? ENV_MAX - 1 : parms[2].gainOut;

    dgain[0] = (gain02 - gain01 + (N >> 1)) >> LG_N;
    dgain[1] = parms[1].gainOut - (parms[1].gainOut === 0 ? ENV_MAX - 1 : parms[1].gainOut);
    dgain[2] = parms[2].gainOut - (parms[2].gainOut === 0 ? ENV_MAX - 1 : parms[2].gainOut);

    for (let i = 0; i < N; i++) {
      const scaledFb = (y0 + y) >> (fbShift + 1);

      gain[0] = (gain[0] + dgain[0]) | 0;
      y0 = y;
      y = mkiSin((phase[0] + scaledFb) | 0, gain[0]);
      phase[0] = (phase[0] + parms[0].freq) | 0;

      gain[1] = (gain[1] + dgain[1]) | 0;
      y = mkiSin((phase[1] + y) | 0, gain[1]);
      phase[1] = (phase[1] + parms[1].freq) | 0;

      gain[2] = (gain[2] + dgain[2]) | 0;
      y = mkiSin((phase[2] + y) | 0, gain[2]);
      phase[2] = (phase[2] + parms[2].freq) | 0;

      output[i] = y;
    }
    fbBuf[0] = y0;
    fbBuf[1] = y;
  }

  override render(
    output: Int32Array,
    params: FmOpParams[],
    algorithm: number,
    fbBuf: Int32Array,
    feedbackShift: number,
  ): void {
    const kLevelThresh = ENV_MAX - 100;
    const alg = algorithms[algorithm].slice();
    const hasContents = [true, false, false];
    const fbOn = feedbackShift < 16;

    if ((algorithm === 3 || algorithm === 5) && fbOn) {
      alg[0] = 0xc4;
    }

    for (let op = 0; op < 6; op++) {
      const flags = alg[op];
      let add = (flags & 0x04) !== 0;
      const param = params[op];
      const inbus = (flags >> 4) & 3;
      const outbus = flags & 3;
      const outptr = outbus === 0 ? output : outbus === 1 ? this.buf0 : this.buf1;
      const gain1 = param.gainOut === 0 ? ENV_MAX - 1 : param.gainOut;
      const gain2 = ENV_MAX - (param.levelIn >> (28 - ENV_BITDEPTH));
      param.gainOut = gain2;

      if (gain1 <= kLevelThresh || gain2 <= kLevelThresh) {
        if (!hasContents[outbus]) {
          add = false;
        }
        if (inbus === 0 || !hasContents[inbus]) {
          if ((flags & 0xc0) === 0xc0 && fbOn) {
            switch (algorithm) {
              case 3:
                this.computeFb3(
                  outptr,
                  params,
                  gain1,
                  gain2,
                  fbBuf,
                  Math.min(feedbackShift + 2, 16),
                );
                params[1].phase = (params[1].phase + (params[1].freq << LG_N)) | 0;
                params[2].phase = (params[2].phase + (params[2].freq << LG_N)) | 0;
                op += 2;
                break;
              case 5:
                this.computeFb2(
                  outptr,
                  params,
                  gain1,
                  gain2,
                  fbBuf,
                  Math.min(feedbackShift + 2, 16),
                );
                params[1].phase = (params[1].phase + (params[1].freq << LG_N)) | 0;
                op++;
                break;
              case 31:
                this.computeFb(
                  outptr,
                  param.phase,
                  param.freq,
                  gain1,
                  gain2,
                  fbBuf,
                  Math.min(feedbackShift + 2, 16),
                  add,
                );
                break;
              default:
                this.computeFb(
                  outptr,
                  param.phase,
                  param.freq,
                  gain1,
                  gain2,
                  fbBuf,
                  feedbackShift,
                  add,
                );
                break;
            }
          } else {
            this.computePure(outptr, param.phase, param.freq, gain1, gain2, add);
          }
        } else {
          const inptr = inbus === 1 ? this.buf0 : this.buf1;
          this.compute(outptr, inptr, param.phase, param.freq, gain1, gain2, add);
        }
        hasContents[outbus] = true;
      } else if (!add) {
        hasContents[outbus] = false;
      }
      param.phase = (param.phase + (param.freq << LG_N)) | 0;
    }
  }
}
