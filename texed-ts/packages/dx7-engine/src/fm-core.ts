// FM algorithm core, ported bit-exactly from msfa/fm_core.cc + fm_core.h.
// The 32-algorithm routing table is copied verbatim from the DX7.

import { LG_N, N } from './synth';
import { Exp2 } from './exp2';
import { FmOpKernel, FmOpParams } from './fm-op-kernel';
import { FmOperatorFlags, algorithms } from '@texed/dx7-format/algorithms';

export { FmOperatorFlags, algorithms, isCarrier } from '@texed/dx7-format/algorithms';

export class FmCore {
  protected buf0 = new Int32Array(N);
  protected buf1 = new Int32Array(N);

  render(
    output: Int32Array,
    params: FmOpParams[],
    algorithm: number,
    fbBuf: Int32Array,
    feedbackShift: number,
  ): void {
    const kLevelThresh = 1120;
    const alg = algorithms[algorithm];
    const hasContents = [true, false, false];
    for (let op = 0; op < 6; op++) {
      const flags = alg[op];
      let add = (flags & FmOperatorFlags.OUT_BUS_ADD) !== 0;
      const param = params[op];
      const inbus = (flags >> 4) & 3;
      const outbus = flags & 3;
      const outptr = outbus === 0 ? output : outbus === 1 ? this.buf0 : this.buf1;
      const gain1 = param.gainOut;
      const gain2 = Exp2.lookup(param.levelIn - 14 * (1 << 24));
      param.gainOut = gain2;

      if (gain1 >= kLevelThresh || gain2 >= kLevelThresh) {
        if (!hasContents[outbus]) {
          add = false;
        }
        if (inbus === 0 || !hasContents[inbus]) {
          if ((flags & 0xc0) === 0xc0 && feedbackShift < 16) {
            FmOpKernel.computeFb(
              outptr,
              param.phase,
              param.freq,
              gain1,
              gain2,
              fbBuf,
              feedbackShift,
              add,
            );
          } else {
            FmOpKernel.computePure(outptr, param.phase, param.freq, gain1, gain2, add);
          }
        } else {
          const inptr = inbus === 1 ? this.buf0 : this.buf1;
          FmOpKernel.compute(outptr, inptr, param.phase, param.freq, gain1, gain2, add);
        }
        hasContents[outbus] = true;
      } else if (!add) {
        hasContents[outbus] = false;
      }
      param.phase = (param.phase + (param.freq << LG_N)) | 0;
    }
  }
}
