// Feed-forward log-domain compressor, ported from Chip Audette's
// AudioEffectCompressor (OpenAudio_ArduinoLibrary) as vendored by Synth_Dexed.
//
// One instance sits on each part. MiniDexed exposes a single global switch but
// still runs one per tone generator, and that per-part gain staging is why
// eight parts can sum without a master limiter.
//
// Attenuation only: the gain block is clamped at 0 dB, so this never makes
// anything louder. The reference's pre-gain and makeup gain are left out
// because MiniDexed never moves them off their neutral values.

import { log10Approx, pow10Approx } from './approx';

const THRESH_DBFS = -20;
const COMP_RATIO = 5;
const ATTACK_SEC = 0.005;
const RELEASE_SEC = 0.2;
/** Envelope follower runs five times faster than the gain smoothing. */
const LEVEL_LP_SEC = Math.max(0.002, Math.min(ATTACK_SEC, RELEASE_SEC) / 5);
/** Floor on the smoothed power estimate, i.e. never below -130 dBFS. */
const MIN_LEVEL_POW = 1e-13;

/** Biquad state and coefficients for the 20 Hz DC-removal prefilter. */
const HP_CUTOFF_HZ = 20;

export class Compressor {
  private attackConst = 0;
  private releaseConst = 0;
  private levelLpConst = 0;

  private prevLevelPow = 1;
  private prevGainDb = 0;

  // Direct form 1 highpass: b0, b1, b2 and the already-negated a1, a2.
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(sampleRate = 44100) {
    this.init(sampleRate);
  }

  init(sampleRate: number): void {
    this.attackConst = Math.exp(-1 / (ATTACK_SEC * sampleRate));
    this.releaseConst = Math.exp(-1 / (RELEASE_SEC * sampleRate));
    this.levelLpConst = Math.exp(-1 / (LEVEL_LP_SEC * sampleRate));

    // Second-order Butterworth highpass by bilinear transform. The reference
    // carries a lookup table of Matlab-generated coefficients and gives up on
    // sample rates it does not recognise; solving it is both shorter and works
    // at any rate.
    const w = Math.tan((Math.PI * HP_CUTOFF_HZ) / sampleRate);
    const norm = 1 / (1 + Math.SQRT2 * w + w * w);
    this.b0 = norm;
    this.b1 = -2 * norm;
    this.b2 = norm;
    this.a1 = -2 * (w * w - 1) * norm;
    this.a2 = -(1 - Math.SQRT2 * w + w * w) * norm;

    this.reset();
  }

  reset(): void {
    this.prevLevelPow = 1;
    this.prevGainDb = 0;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  /** Current gain reduction in dB, for metering. Never positive. */
  get gainReductionDb(): number {
    return this.prevGainDb;
  }

  process(block: Float32Array, len: number): void {
    const c1 = this.levelLpConst;
    const c2 = 1 - c1;
    const oneMinusAttack = 1 - this.attackConst;
    const oneMinusRelease = 1 - this.releaseConst;
    // Above the threshold, every dB of input buys 1/ratio dB of output.
    const slope = 1 / COMP_RATIO - 1;

    for (let i = 0; i < len; i++) {
      const x = block[i];
      const y =
        this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 + this.a1 * this.y1 + this.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = x;
      this.y2 = this.y1;
      this.y1 = y;

      const pow = c1 * this.prevLevelPow + c2 * y * y;
      this.prevLevelPow = pow;

      const levelDb = 10 * log10Approx(pow);
      const targetDb = Math.min(0, (levelDb - THRESH_DBFS) * slope);

      const smoothed =
        targetDb < this.prevGainDb
          ? this.attackConst * this.prevGainDb + oneMinusAttack * targetDb
          : this.releaseConst * this.prevGainDb + oneMinusRelease * targetDb;
      this.prevGainDb = smoothed;

      block[i] = y * pow10Approx(smoothed / 20);
    }

    // Clamped once per block, as in the reference, so the follower cannot walk
    // off toward negative infinity during silence.
    if (this.prevLevelPow < MIN_LEVEL_POW) this.prevLevelPow = MIN_LEVEL_POW;
  }
}
