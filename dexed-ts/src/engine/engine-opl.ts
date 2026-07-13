// OPL-style engine, ported bit-exactly from EngineOpl.cpp.
// Extends FmCore, overriding render and the operator kernels.

import { LG_N, N } from './synth';
import { FmCore, algorithms } from './fm-core';
import type { FmOpParams } from './fm-op-kernel';

const SignBit = 0x8000;

// prettier-ignore
const sinLogTable = [
  2137, 1731, 1543, 1419, 1326, 1252, 1190, 1137, 1091, 1050, 1013, 979, 949, 920, 894, 869,
  846, 825, 804, 785, 767, 749, 732, 717, 701, 687, 672, 659, 646, 633, 621, 609,
  598, 587, 576, 566, 556, 546, 536, 527, 518, 509, 501, 492, 484, 476, 468, 461,
  453, 446, 439, 432, 425, 418, 411, 405, 399, 392, 386, 380, 375, 369, 363, 358,
  352, 347, 341, 336, 331, 326, 321, 316, 311, 307, 302, 297, 293, 289, 284, 280,
  276, 271, 267, 263, 259, 255, 251, 248, 244, 240, 236, 233, 229, 226, 222, 219,
  215, 212, 209, 205, 202, 199, 196, 193, 190, 187, 184, 181, 178, 175, 172, 169,
  167, 164, 161, 159, 156, 153, 151, 148, 146, 143, 141, 138, 136, 134, 131, 129,
  127, 125, 122, 120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100, 98, 96,
  94, 92, 91, 89, 87, 85, 83, 82, 80, 78, 77, 75, 74, 72, 70, 69,
  67, 66, 64, 63, 62, 60, 59, 57, 56, 55, 53, 52, 51, 49, 48, 47,
  46, 45, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30,
  29, 28, 27, 26, 25, 24, 23, 23, 22, 21, 20, 20, 19, 18, 17, 17,
  16, 15, 15, 14, 13, 13, 12, 12, 11, 10, 10, 9, 9, 8, 8, 7,
  7, 7, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2,
  2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
];

// prettier-ignore
const sinExpTable = [
  0, 3, 6, 8, 11, 14, 17, 20, 22, 25, 28, 31, 34, 37, 40, 42,
  45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90,
  93, 96, 99, 102, 105, 108, 111, 114, 117, 120, 123, 126, 130, 133, 136, 139,
  142, 145, 148, 152, 155, 158, 161, 164, 168, 171, 174, 177, 181, 184, 187, 190,
  194, 197, 200, 204, 207, 210, 214, 217, 220, 224, 227, 231, 234, 237, 241, 244,
  248, 251, 255, 258, 262, 265, 268, 272, 276, 279, 283, 286, 290, 293, 297, 300,
  304, 308, 311, 315, 318, 322, 326, 329, 333, 337, 340, 344, 348, 352, 355, 359,
  363, 367, 370, 374, 378, 382, 385, 389, 393, 397, 401, 405, 409, 412, 416, 420,
  424, 428, 432, 436, 440, 444, 448, 452, 456, 460, 464, 468, 472, 476, 480, 484,
  488, 492, 496, 501, 505, 509, 513, 517, 521, 526, 530, 534, 538, 542, 547, 551,
  555, 560, 564, 568, 572, 577, 581, 585, 590, 594, 599, 603, 607, 612, 616, 621,
  625, 630, 634, 639, 643, 648, 652, 657, 661, 666, 670, 675, 680, 684, 689, 693,
  698, 703, 708, 712, 717, 722, 726, 731, 736, 741, 745, 750, 755, 760, 765, 770,
  774, 779, 784, 789, 794, 799, 804, 809, 814, 819, 824, 829, 834, 839, 844, 849,
  854, 859, 864, 869, 874, 880, 885, 890, 895, 900, 906, 911, 916, 921, 927, 932,
  937, 942, 948, 953, 959, 964, 969, 975, 980, 986, 991, 996, 1002, 1007, 1013, 1018,
];

function sinLog(phi: number): number {
  const index = phi & 0xff;
  switch (phi & 0x0300) {
    case 0x0000:
      return sinLogTable[index];
    case 0x0100:
      return sinLogTable[index ^ 0xff];
    case 0x0200:
      return sinLogTable[index] | SignBit;
    default:
      return sinLogTable[index ^ 0xff] | SignBit;
  }
}

function oplSin(phase: number, env: number): number {
  let expVal = (sinLog(phase & 0xffff) + (env << 3)) & 0xffff;
  const isSigned = expVal & SignBit;
  expVal &= ~SignBit & 0xffff;
  let result = 0x0400 + sinExpTable[(expVal & 0xff) ^ 0xff];
  result <<= 1;
  result = result >>> (expVal >> 8);
  if (isSigned) {
    return -result - 1;
  }
  return result;
}

export class EngineOpl extends FmCore {
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
      const y = oplSin(((phase + input[i]) | 0) >> 14, gain);
      output[i] = add ? ((y << 14) + output[i]) | 0 : (y << 14) | 0;
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
      const y = oplSin(phase >> 14, gain);
      output[i] = add ? ((y << 14) + output[i]) | 0 : (y << 14) | 0;
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
      y = oplSin(((phase + scaledFb) | 0) >> 14, gain) << 14;
      output[i] = add ? (y + output[i]) | 0 : y;
      phase = (phase + freq) | 0;
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
    const kLevelThresh = 507;
    const alg = algorithms[algorithm];
    const hasContents = [true, false, false];
    for (let op = 0; op < 6; op++) {
      const flags = alg[op];
      let add = (flags & 0x04) !== 0;
      const param = params[op];
      const inbus = (flags >> 4) & 3;
      const outbus = flags & 3;
      const outptr = outbus === 0 ? output : outbus === 1 ? this.buf0 : this.buf1;
      const gain1 = param.gainOut === 0 ? 511 : param.gainOut;
      const gain2 = 512 - (param.levelIn >> 19);
      param.gainOut = gain2;

      if (gain1 <= kLevelThresh || gain2 <= kLevelThresh) {
        if (!hasContents[outbus]) {
          add = false;
        }
        if (inbus === 0 || !hasContents[inbus]) {
          if ((flags & 0xc0) === 0xc0 && feedbackShift < 16) {
            this.computeFb(outptr, param.phase, param.freq, gain1, gain2, fbBuf, feedbackShift, add);
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
