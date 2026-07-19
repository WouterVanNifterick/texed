// Low frequency oscillator, DX7-compatible, ported bit-exactly from
// msfa/lfo.cc + lfo.h. Phase and increments are treated as uint32.

import { N } from './synth';
import { Sin } from './sin';

// prettier-ignore
export const lfoSource = [
  0.062541, 0.125031, 0.312393, 0.437120, 0.624610,
  0.750694, 0.936330, 1.125302, 1.249609, 1.436782,
  1.560915, 1.752081, 1.875117, 2.062494, 2.247191,
  2.374451, 2.560492, 2.686728, 2.873976, 2.998950,
  3.188013, 3.369840, 3.500175, 3.682224, 3.812065,
  4.000800, 4.186202, 4.310716, 4.501260, 4.623209,
  4.814636, 4.930480, 5.121901, 5.315191, 5.434783,
  5.617346, 5.750431, 5.946717, 6.062811, 6.248438,
  6.431695, 6.564264, 6.749460, 6.868132, 7.052186,
  7.250580, 7.375719, 7.556294, 7.687577, 7.877738,
  7.993605, 8.181967, 8.372405, 8.504848, 8.685079,
  8.810573, 8.986341, 9.122423, 9.300595, 9.500285,
  9.607994, 9.798158, 9.950249, 10.117361, 11.251125,
  11.384335, 12.562814, 13.676149, 13.904338, 15.092062,
  16.366612, 16.638935, 17.869907, 19.193858, 19.425019,
  20.833333, 21.034918, 22.502250, 24.003841, 24.260068,
  25.746653, 27.173913, 27.578599, 29.052876, 30.693677,
  31.191516, 32.658393, 34.317090, 34.674064, 36.416606,
  38.197097, 38.550501, 40.387722, 40.749796, 42.625746,
  44.326241, 44.883303, 46.772685, 48.590865, 49.261084,
];

const U32 = 0xffffffff;

let unit = 0;
let lforatio = 0;

export class Lfo {
  private phase = 0; // Q32 uint
  private delta = 0;
  private waveform = 0;
  private randstate = 0;
  private sync = false;
  private delaystate = 0;
  private delayinc = 0;
  private delayinc2 = 0;

  static init(sampleRate: number): void {
    // constant is (1 << 32) / 15.5s / 11
    unit = Math.floor((N * 25190424) / sampleRate + 0.5);
    lforatio = Math.trunc((4437500000.0 * N) / sampleRate);
  }

  reset(params: ArrayLike<number>): void {
    const rate = params[0]; // 0..99
    this.delta = Math.trunc(lfoSource[rate] * lforatio) >>> 0;
    let a = 99 - params[1]; // LFO delay
    if (a === 99) {
      this.delayinc = U32;
      this.delayinc2 = U32;
    } else {
      a = (16 + (a & 15)) << (1 + (a >> 4));
      this.delayinc = Math.imul(unit, a) >>> 0;
      a &= 0xff80;
      a = a > 0x80 ? a : 0x80;
      this.delayinc2 = Math.imul(unit, a) >>> 0;
    }
    this.waveform = params[5];
    this.sync = params[4] !== 0;
  }

  getsample(): number {
    this.phase = (this.phase + this.delta) >>> 0;
    let x: number;
    switch (this.waveform) {
      case 0: // triangle
        x = this.phase >>> 7;
        x ^= -(this.phase >>> 31);
        x &= (1 << 24) - 1;
        return x;
      case 1: // sawtooth down
        return (~this.phase ^ (1 << 31)) >>> 8;
      case 2: // sawtooth up
        return (this.phase ^ (1 << 31)) >>> 8;
      case 3: // square
        return (~this.phase >>> 7) & (1 << 24);
      case 4: // sine
        return (1 << 23) + (Sin.lookup(this.phase >>> 8) >> 1);
      case 5: // s&h
        if (this.phase < this.delta) {
          this.randstate = (this.randstate * 179 + 17) & 0xff;
        }
        x = this.randstate ^ 0x80;
        return (x + 1) << 16;
    }
    return 1 << 23;
  }

  getdelay(): number {
    const delta = this.delaystate < (1 << 31) >>> 0 ? this.delayinc : this.delayinc2;
    const d = this.delaystate + delta;
    if (d > U32) {
      return 1 << 24;
    }
    this.delaystate = d;
    if (d < (1 << 31) >>> 0) {
      return 0;
    }
    return Math.floor(d / 128) & ((1 << 24) - 1);
  }

  keydown(): void {
    if (this.sync) {
      this.phase = (1 << 31) - 1;
    }
    this.delaystate = 0;
  }
}
