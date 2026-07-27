// Dexed's post-synthesis chain (Source/PluginFx.cpp): DC blocker, a ramped
// output gain, and the 4-pole resonant ladder taken from the OBXd project.
// MiniDexed's per-tone-generator Cutoff and Resonance are this filter, and its
// gain ramp is what keeps a MIDI volume change from clicking.
//
// The ladder self-bypasses at cutoff 1 and the ramp is a no-op at unity gain,
// so an untouched instance only runs the DC blocker.

import { atanApprox } from './approx';

// Filter state, held in one buffer so the helpers can take an index and the
// audio path never allocates.
const S1 = 0;
const S2 = 1;
const S3 = 2;
const S4 = 3;
const C = 4;
const D = 5;

/** One-pole topology-preserving transform, as in the C++ original. */
function tptpc(st: Float64Array, i: number, inp: number, cutoff: number): number {
  const v = ((inp - st[i]) * cutoff) / (1 + cutoff);
  const res = v + st[i];
  st[i] = res + v;
  return res;
}

/** Same, with the cutoff given in Hz rather than prewarped. */
function tptlpupw(st: Float64Array, i: number, inp: number, hz: number, srInv: number): number {
  const cutoff = hz * srInv * Math.PI;
  const v = ((inp - st[i]) * cutoff) / (1 + cutoff);
  const res = v + st[i];
  st[i] = res + v;
  return res;
}

/** Exponential taper with the OBXd rolloff of 19. */
function logsc(param: number, min: number, max: number, rolloff = 19): number {
  return ((Math.exp(param * Math.log(rolloff + 1)) - 1) / rolloff) * (max - min) + min;
}

export class PluginFx {
  /** Filter cutoff 0..1; 1 bypasses the ladder entirely. */
  cutoff = 1;
  /** Filter resonance 0..1. */
  resonance = 0;
  /** Target output gain. Reached over ~100 ms so changes do not click. */
  gain = 1;

  /**
   * Whether this instance removes DC. The rack runs one blocker on the master
   * bus rather than one per part; a blocker is linear, so which side of the mix
   * it sits on does not change the result beyond rounding.
   */
  dcBlock = true;

  private st = new Float64Array(6);
  private aGain = 1;
  private rampDt = 10.0 / 44100;

  private sampleRateInv = 1 / 44100;
  private bright = 0;
  private rcor24 = 0;
  private rcor24Inv = 0;
  private r24 = 0;
  private rCutoff = 0;

  // Cached against `cutoff` / `resonance` so the coefficient solve only runs
  // when something actually moved.
  private pCutoff = -1;
  private pReso = -1;

  private dcId = 0;
  private dcOd = 0;
  private dcR = 0;

  init(sr: number): void {
    this.sampleRateInv = 1 / sr;
    this.rampDt = 10.0 / sr; // full-scale gain change in 100 ms

    const rcrate = Math.sqrt(44000 / sr);
    this.rcor24 = (970.0 / 44000) * rcrate;
    this.rcor24Inv = 1 / this.rcor24;
    this.bright = Math.tan((sr * 0.5 - 10) * Math.PI * this.sampleRateInv);

    this.r24 = 0;
    this.pCutoff = -1;
    this.pReso = -1;
    this.dcR = 1.0 - 126.0 / sr;
    this.resetState();
  }

  resetState(): void {
    this.dcId = 0;
    this.dcOd = 0;
    this.st.fill(0);
  }

  /** Zero-delay-feedback solve for the 4-pole ladder. */
  private nr24(sample: number, g: number, lpc: number): number {
    const st = this.st;
    const ml = 1 / (1 + g);
    const s = (lpc * (lpc * (lpc * st[S1] + st[S2]) + st[S3]) + st[S4]) * ml;
    const gg = lpc * lpc * lpc * lpc;
    return (sample - this.r24 * s) / (1 + this.r24 * gg) + 1e-8;
  }

  process(work: Float32Array, sampleSize: number): void {
    if (sampleSize <= 0) return;

    if (this.dcBlock) {
      let tFd = work[0];
      work[0] = work[0] - this.dcId + this.dcR * this.dcOd;
      this.dcId = tFd;
      for (let i = 1; i < sampleSize; i++) {
        tFd = work[i];
        work[i] = work[i] - this.dcId + this.dcR * work[i - 1];
        this.dcId = tFd;
      }
      this.dcOd = work[sampleSize - 1];
    }

    if (this.gain !== this.aGain) {
      for (let i = 0; i < sampleSize; i++) {
        if (this.aGain !== this.gain) {
          this.aGain =
            this.gain > this.aGain
              ? Math.min(this.gain, this.aGain + this.rampDt)
              : Math.max(this.gain, this.aGain - this.rampDt);
        }
        work[i] *= this.aGain;
      }
    } else if (this.aGain === 0) {
      work.fill(0, 0, sampleSize);
    } else if (this.aGain !== 1) {
      for (let i = 0; i < sampleSize; i++) work[i] *= this.aGain;
    }

    if (this.cutoff >= 1) return;

    if (this.cutoff !== this.pCutoff || this.resonance !== this.pReso) {
      const rReso = 0.991 - logsc(1 - this.resonance, 0, 0.991);
      this.r24 = 3.5 * rReso;
      this.rCutoff = Math.tan(logsc(this.cutoff, 60, 19000) * this.sampleRateInv * Math.PI);
      this.pCutoff = this.cutoff;
      this.pReso = this.resonance;
    }

    const st = this.st;
    const g = this.rCutoff;
    const lpc = g / (1 + g);
    const makeup = 1 + this.r24 * 0.45;

    for (let i = 0; i < sampleSize; i++) {
      let s = work[i];
      s = s - 0.45 * tptlpupw(st, C, s, 15, this.sampleRateInv);
      s = tptpc(st, D, s, this.bright);

      const y0 = this.nr24(s, g, lpc);

      const v = (y0 - st[S1]) * lpc;
      const res = v + st[S1];
      st[S1] = res + v;
      // Nonlinear damping in the first stage: this is what gives the ladder its
      // character, and why it needs an arctangent every sample.
      st[S1] = atanApprox(st[S1] * this.rcor24) * this.rcor24Inv;

      const y2 = tptpc(st, S2, res, g);
      const y3 = tptpc(st, S3, y2, g);
      const y4 = tptpc(st, S4, y3, g);

      work[i] = y4 * makeup;
    }
  }
}
