// DX7 pitch envelope, ported bit-exactly from msfa/pitchenv.cc + pitchenv.h.
// Result is Q24/octave, subsampled once per N-sample block.

import { N } from './synth';

let unit = 0;

// prettier-ignore
export const pitchenvRate = [
  1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12,
  12, 13, 13, 14, 14, 15, 16, 16, 17, 18, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 30, 31, 33, 34, 36, 37, 38, 39, 41, 42, 44, 46, 47,
  49, 51, 53, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 79, 82,
  85, 88, 91, 94, 98, 102, 106, 110, 115, 120, 125, 130, 135, 141, 147,
  153, 159, 165, 171, 178, 185, 193, 202, 211, 232, 243, 254, 255,
];

// prettier-ignore
export const pitchenvTab = [
  -128, -116, -104, -95, -85, -76, -68, -61, -56, -52, -49, -46, -43,
  -41, -39, -37, -35, -33, -32, -31, -30, -29, -28, -27, -26, -25, -24,
  -23, -22, -21, -20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10,
  -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32, 33, 34, 35, 38, 40, 43, 46, 49, 53, 58, 65, 73,
  82, 92, 103, 115, 127,
];

export class PitchEnv {
  private rates = new Int32Array(4);
  private levels = new Int32Array(4);
  private level = 0;
  private targetlevel = 0;
  private rising = false;
  private ix = 0;
  private inc = 0;
  private down = true;

  static init(sampleRate: number): void {
    unit = Math.floor((N * (1 << 24)) / (21.3 * sampleRate) + 0.5);
  }

  set(r: ArrayLike<number>, l: ArrayLike<number>): void {
    for (let i = 0; i < 4; i++) {
      this.rates[i] = r[i];
      this.levels[i] = l[i];
    }
    this.level = pitchenvTab[l[3]] << 19;
    this.down = true;
    this.advance(0);
  }

  getsample(): number {
    if (this.ix < 3 || (this.ix < 4 && !this.down)) {
      if (this.rising) {
        this.level += this.inc;
        if (this.level >= this.targetlevel) {
          this.level = this.targetlevel;
          this.advance(this.ix + 1);
        }
      } else {
        this.level -= this.inc;
        if (this.level <= this.targetlevel) {
          this.level = this.targetlevel;
          this.advance(this.ix + 1);
        }
      }
    }
    return this.level;
  }

  keydown(d: boolean): void {
    if (this.down !== d) {
      this.down = d;
      this.advance(d ? 0 : 3);
    }
  }

  private advance(newix: number): void {
    this.ix = newix;
    if (this.ix < 4) {
      const newlevel = this.levels[this.ix];
      this.targetlevel = pitchenvTab[newlevel] << 19;
      this.rising = this.targetlevel > this.level;
      this.inc = pitchenvRate[this.rates[this.ix]] * unit;
    }
  }

  getPosition(): number {
    return this.ix;
  }
}
