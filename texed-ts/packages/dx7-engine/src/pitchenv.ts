// DX7 pitch envelope, ported bit-exactly from msfa/pitchenv.cc + pitchenv.h.
// Result is Q24/octave, subsampled once per N-sample block.

import { N } from './synth';
import { pitchIncAt, pitchLevelAt } from './env-tables';
import { EGS_UNIT_Q24, SLOW_TICK_HZ, isHardwareAccurate } from './engine-accuracy';

export { pitchenvRate, pitchenvTab } from './env-tables';

let unit = 0;

/**
 * Q24 pitch increment per block for one unit of pitch EG rate.
 *
 * PITCH_EG_PROCESS adds the rate byte straight to the 4096-per-octave voice
 * pitch, on every other output-compare interrupt. msfa's 21.3 assumes a
 * ~192.3 Hz tick against the hardware's ~187.63 Hz, i.e. 2.5% fast.
 *
 * Rate 99 is not a discontinuity (unlike porta time 0 / `INSTANT`). See
 * "Pitch EG rate 99 is a ramp" in docs/architecture.md.
 *
 * Exported so env-sim draws the same curve the engine plays.
 */
export function pitchEnvUnit(sampleRate: number): number {
  return isHardwareAccurate()
    ? Math.floor((N * EGS_UNIT_Q24 * SLOW_TICK_HZ) / sampleRate + 0.5)
    : Math.floor((N * (1 << 24)) / (21.3 * sampleRate) + 0.5);
}

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
    unit = pitchEnvUnit(sampleRate);
  }

  set(r: ArrayLike<number>, l: ArrayLike<number>): void {
    this.copyParams(r, l);
    this.level = pitchLevelAt(l[3]);
    this.down = true;
    this.advance(0);
  }

  /** Live edit: refresh rates/levels without restarting the running envelope. */
  update(r: ArrayLike<number>, l: ArrayLike<number>): void {
    this.copyParams(r, l);
    this.advance(this.ix);
  }

  getsample(): number {
    if (this.ix < 3 || (this.ix < 4 && !this.down)) {
      const up = this.rising;
      this.level += up ? this.inc : -this.inc;
      if (up ? this.level >= this.targetlevel : this.level <= this.targetlevel) {
        this.level = this.targetlevel;
        this.advance(this.ix + 1);
      }
    }
    return this.level;
  }

  private copyParams(r: ArrayLike<number>, l: ArrayLike<number>): void {
    for (let i = 0; i < 4; i++) {
      this.rates[i] = r[i];
      this.levels[i] = l[i];
    }
  }

  keydown(d: boolean): void {
    if (this.down !== d) {
      this.down = d;
      this.advance(d ? 0 : 3);
    }
  }

  private advance(newix: number): void {
    this.ix = newix;
    if (this.ix >= 4) return;
    this.targetlevel = pitchLevelAt(this.levels[this.ix]);
    this.rising = this.targetlevel > this.level;
    this.inc = pitchIncAt(this.rates[this.ix], unit);
  }

  getPosition(): number {
    return this.ix;
  }

  /** Current Q24-per-octave level (matches env-sim's pitch curve units). */
  getLevel(): number {
    return this.level;
  }
}
