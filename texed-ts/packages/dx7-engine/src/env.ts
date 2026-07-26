// DX7 amplitude envelope, ported bit-exactly from msfa/env.cc + env.h.
// ACCURATE_ENVELOPE is enabled (as in Dexed). Result is Q24/doubling log,
// subsampled once per N-sample block.

import { N } from './synth';
import { ampIncAt, ampLevelBase, ampStaticAt } from './env-tables';

export { scaleoutlevel } from './env-tables';

let srMultiplier = 1 << 24;
let sampleRate = 44100;

// TX802 EG Forced Damp: a stolen voice fades to silence over this window before
// its slot is reclaimed, avoiding the click of an instantaneous cut.
const DAMP_MS = 6;

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
  private damping = false;

  static initSr(sr: number): void {
    sampleRate = sr;
    srMultiplier = (44100.0 / sr) * (1 << 24);
  }

  init(
    r: ArrayLike<number>,
    l: ArrayLike<number>,
    ol: number,
    rateScaling: number,
    continueEnv = false,
  ): void {
    this.initialised = true;
    for (let i = 0; i < 4; i++) {
      this.rates[i] = r[i];
      this.levels[i] = l[i];
    }
    this.outlevel = ol;
    this.rateScaling = rateScaling;
    // Forced Damp OFF (continueEnv): keep the current level so the new note's
    // attack continues from where the stolen note left off (the part of the
    // attack below that level is not reproduced). ON: restart from zero.
    if (!continueEnv) this.level = 0;
    this.down = true;
    this.damping = false;
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

  /**
   * TX802 forced damp: ramp quickly to silence (~DAMP_MS) instead of the note's
   * own release, so a stolen voice can be reclaimed without a click. Drives the
   * existing !rising descent branch toward targetlevel 0, then advance(4).
   */
  forceDamp(): void {
    this.down = false;
    this.rising = false;
    this.damping = true;
    this.staticcount = 0;
    this.targetlevel = 0;
    this.ix = 3;
    const blocks = Math.max(1, (((DAMP_MS / 1000) * sampleRate) / N) | 0);
    this.inc = Math.max(1, (this.level / blocks) | 0);
  }

  private advance(newix: number): void {
    this.ix = newix;
    if (this.ix < 4) {
      const newlevel = this.levels[this.ix];
      let actuallevel = ampLevelBase(newlevel) + this.outlevel - 4256;
      actuallevel = actuallevel < 16 ? 16 : actuallevel;
      this.targetlevel = actuallevel << 16;
      this.rising = this.targetlevel > this.level;

      const shortHold = this.ix === 0 && newlevel === 0 ? 1 : 0;
      if (this.targetlevel === this.level || shortHold) {
        const staticrate = Math.min(99, this.rates[this.ix] + this.rateScaling);
        this.staticcount = ampStaticAt(staticrate, srMultiplier, shortHold);
      } else {
        this.staticcount = 0;
      }

      this.inc = ampIncAt(this.rates[this.ix], srMultiplier, this.rateScaling);
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
      // Deliberately without `+ this.outlevel`, matching msfa's env.cc.
      let actuallevel = ampLevelBase(newlevel) - 4256;
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
    this.damping = src.damping;
  }

  isActive(): boolean {
    if (this.damping && this.ix >= 4) return false;
    return this.initialised && (this.ix < 4 || this.levels[3] > 0);
  }
}
