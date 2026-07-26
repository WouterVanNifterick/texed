// DX7 pitch envelope, ported bit-exactly from msfa/pitchenv.cc + pitchenv.h.
// Result is Q24/octave, subsampled once per N-sample block.

import { N } from './synth';
import { pitchIncAt, pitchLevelAt } from './env-tables';

export { pitchenvRate, pitchenvTab } from './env-tables';

let unit = 0;

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
    this.level = pitchLevelAt(l[3]);
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
      this.targetlevel = pitchLevelAt(newlevel);
      this.rising = this.targetlevel > this.level;
      this.inc = pitchIncAt(this.rates[this.ix], unit);
    }
  }

  getPosition(): number {
    return this.ix;
  }

  /** Current Q24-per-octave level (matches env-sim's pitch curve units). */
  getLevel(): number {
    return this.level;
  }
}
