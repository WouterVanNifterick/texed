// FM algorithm core, ported bit-exactly from msfa/fm_core.cc + fm_core.h.
// The 32-algorithm routing table is copied verbatim from the DX7.

import { LG_N, N } from './synth';
import { Exp2 } from './exp2';
import { FmOpKernel, FmOpParams } from './fm-op-kernel';

export const FmOperatorFlags = {
  OUT_BUS_ONE: 1 << 0,
  OUT_BUS_TWO: 1 << 1,
  OUT_BUS_ADD: 1 << 2,
  IN_BUS_ONE: 1 << 4,
  IN_BUS_TWO: 1 << 5,
  FB_IN: 1 << 6,
  FB_OUT: 1 << 7,
} as const;

// prettier-ignore
export const algorithms: number[][] = [
  [0xc1, 0x11, 0x11, 0x14, 0x01, 0x14], // 1
  [0x01, 0x11, 0x11, 0x14, 0xc1, 0x14], // 2
  [0xc1, 0x11, 0x14, 0x01, 0x11, 0x14], // 3
  [0xc1, 0x11, 0x94, 0x01, 0x11, 0x14], // 4
  [0xc1, 0x14, 0x01, 0x14, 0x01, 0x14], // 5
  [0xc1, 0x94, 0x01, 0x14, 0x01, 0x14], // 6
  [0xc1, 0x11, 0x05, 0x14, 0x01, 0x14], // 7
  [0x01, 0x11, 0xc5, 0x14, 0x01, 0x14], // 8
  [0x01, 0x11, 0x05, 0x14, 0xc1, 0x14], // 9
  [0x01, 0x05, 0x14, 0xc1, 0x11, 0x14], // 10
  [0xc1, 0x05, 0x14, 0x01, 0x11, 0x14], // 11
  [0x01, 0x05, 0x05, 0x14, 0xc1, 0x14], // 12
  [0xc1, 0x05, 0x05, 0x14, 0x01, 0x14], // 13
  [0xc1, 0x05, 0x11, 0x14, 0x01, 0x14], // 14
  [0x01, 0x05, 0x11, 0x14, 0xc1, 0x14], // 15
  [0xc1, 0x11, 0x02, 0x25, 0x05, 0x14], // 16
  [0x01, 0x11, 0x02, 0x25, 0xc5, 0x14], // 17
  [0x01, 0x11, 0x11, 0xc5, 0x05, 0x14], // 18
  [0xc1, 0x14, 0x14, 0x01, 0x11, 0x14], // 19
  [0x01, 0x05, 0x14, 0xc1, 0x14, 0x14], // 20
  [0x01, 0x14, 0x14, 0xc1, 0x14, 0x14], // 21
  [0xc1, 0x14, 0x14, 0x14, 0x01, 0x14], // 22
  [0xc1, 0x14, 0x14, 0x01, 0x14, 0x04], // 23
  [0xc1, 0x14, 0x14, 0x14, 0x04, 0x04], // 24
  [0xc1, 0x14, 0x14, 0x04, 0x04, 0x04], // 25
  [0xc1, 0x05, 0x14, 0x01, 0x14, 0x04], // 26
  [0x01, 0x05, 0x14, 0xc1, 0x14, 0x04], // 27
  [0x04, 0xc1, 0x11, 0x14, 0x01, 0x14], // 28
  [0xc1, 0x14, 0x01, 0x14, 0x04, 0x04], // 29
  [0x04, 0xc1, 0x11, 0x14, 0x04, 0x04], // 30
  [0xc1, 0x14, 0x04, 0x04, 0x04, 0x04], // 31
  [0xc4, 0x04, 0x04, 0x04, 0x04, 0x04], // 32
];

export function isCarrier(algorithm: number, op: number): boolean {
  return (algorithms[algorithm][op] & FmOperatorFlags.OUT_BUS_ADD) !== 0;
}

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
