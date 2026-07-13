// DX7 amplitude envelope, ported bit-exactly from msfa/env.cc + env.h.
// ACCURATE_ENVELOPE is enabled (as in Dexed). Result is Q24/doubling log,
// subsampled once per N-sample block.

import { LG_N, N } from './synth';
import { sar64 } from './fixedpoint';

let srMultiplier = 1 << 24;

const levellut = [0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46];

// prettier-ignore
const statics = [
  1764000, 1764000, 1411200, 1411200, 1190700, 1014300, 992250,
  882000, 705600, 705600, 584325, 507150, 502740, 441000, 418950,
  352800, 308700, 286650, 253575, 220500, 220500, 176400, 145530,
  145530, 125685, 110250, 110250, 88200, 88200, 74970, 61740,
  61740, 55125, 48510, 44100, 37485, 31311, 30870, 27562, 27562,
  22050, 18522, 17640, 15435, 14112, 13230, 11025, 9261, 9261, 7717,
  6615, 6615, 5512, 5512, 4410, 3969, 3969, 3439, 2866, 2690, 2249,
  1984, 1896, 1808, 1411, 1367, 1234, 1146, 926, 837, 837, 705,
  573, 573, 529, 441, 441,
];

export function scaleoutlevel(outlevel: number): number {
  return outlevel >= 20 ? 28 + outlevel : levellut[outlevel];
}

export class Env {
  private initialised = false;
  private rates = new Int32Array(4);
  private levels = new Int32Array(4);
  private outlevel = 0;
  private rateScaling = 0;
  // 2^24 is one doubling.
  private level = 0;
  private targetlevel = 0;
  private rising = false;
  private ix = 0;
  private inc = 0;
  private staticcount = 0;
  private down = true;

  static initSr(sampleRate: number): void {
    srMultiplier = (44100.0 / sampleRate) * (1 << 24);
  }

  init(r: ArrayLike<number>, l: ArrayLike<number>, ol: number, rateScaling: number): void {
    this.initialised = true;
    for (let i = 0; i < 4; i++) {
      this.rates[i] = r[i];
      this.levels[i] = l[i];
    }
    this.outlevel = ol;
    this.rateScaling = rateScaling;
    this.level = 0;
    this.down = true;
    this.advance(0);
  }

  getsample(): number {
    if (this.staticcount) {
      this.staticcount -= N;
      if (this.staticcount <= 0) {
        this.staticcount = 0;
        this.advance(this.ix + 1);
      }
    }

    if (this.ix < 3 || (this.ix < 4 && !this.down)) {
      if (this.staticcount) {
        // holding: no level change this block
      } else if (this.rising) {
        const jumptarget = 1716;
        if (this.level < jumptarget << 16) {
          this.level = jumptarget << 16;
        }
        this.level = (this.level + Math.imul(((17 << 24) - this.level) >> 24, this.inc)) | 0;
        if (this.level >= this.targetlevel) {
          this.level = this.targetlevel;
          this.advance(this.ix + 1);
        }
      } else {
        // !rising
        this.level = (this.level - this.inc) | 0;
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
      let actuallevel = scaleoutlevel(newlevel) >> 1;
      actuallevel = (actuallevel << 6) + this.outlevel - 4256;
      actuallevel = actuallevel < 16 ? 16 : actuallevel;
      this.targetlevel = actuallevel << 16;
      this.rising = this.targetlevel > this.level;

      let qrate = (this.rates[this.ix] * 41) >> 6;
      qrate += this.rateScaling;
      qrate = qrate < 63 ? qrate : 63;

      if (this.targetlevel === this.level || (this.ix === 0 && newlevel === 0)) {
        let staticrate = this.rates[this.ix];
        staticrate += this.rateScaling;
        staticrate = staticrate < 99 ? staticrate : 99;
        this.staticcount = staticrate < 77 ? statics[staticrate] : 20 * (99 - staticrate);
        if (staticrate < 77 && this.ix === 0 && newlevel === 0) {
          this.staticcount = (this.staticcount / 20) | 0;
        }
        this.staticcount = sar64(this.staticcount * srMultiplier, 24);
      } else {
        this.staticcount = 0;
      }

      this.inc = (4 + (qrate & 3)) << (2 + LG_N + (qrate >> 2));
      this.inc = sar64(this.inc * srMultiplier, 24);
    }
  }

  update(r: ArrayLike<number>, l: ArrayLike<number>, ol: number, rateScaling: number): void {
    for (let i = 0; i < 4; i++) {
      this.rates[i] = r[i];
      this.levels[i] = l[i];
    }
    this.outlevel = ol;
    this.rateScaling = rateScaling;
    if (this.down) {
      const newlevel = this.levels[2];
      let actuallevel = scaleoutlevel(newlevel) >> 1;
      actuallevel = (actuallevel << 6) - 4256;
      actuallevel = actuallevel < 16 ? 16 : actuallevel;
      this.targetlevel = actuallevel << 16;
      this.advance(2);
    }
  }

  getPosition(): number {
    return this.ix;
  }

  transfer(src: Env): void {
    for (let i = 0; i < 4; i++) {
      this.rates[i] = src.rates[i];
      this.levels[i] = src.levels[i];
    }
    this.outlevel = src.outlevel;
    this.rateScaling = src.rateScaling;
    this.level = src.level;
    this.targetlevel = src.targetlevel;
    this.rising = src.rising;
    this.ix = src.ix;
    this.down = src.down;
    this.staticcount = src.staticcount;
    this.inc = src.inc;
  }

  isActive(): boolean {
    return this.initialised && (this.ix < 4 || this.levels[3] > 0);
  }
}
