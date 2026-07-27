// Stereo plate reverb, ported from MiniDexed's src/effect_platervbstereo.cpp
// (Piotr Zapart / hexefx, adapted by Holger Wirtz), whose algorithm follows the
// plate reverbs written for the Spin Semiconductor FV-1.
//
// Four input allpasses per channel feed a figure-eight loop of four more
// allpasses, each followed by a delay line and a hi/lo shelving damper. Four
// taps per channel are read back out, three of them interpolated and modulated
// by a pair of slow LFOs, which is where the chorused tail comes from.
//
// Every buffer is allocated up front: nothing here may allocate on the audio
// thread. Delay lengths are in samples and, as in the original, are not scaled
// with the sample rate - the reverb gets shorter as the rate goes up.

const IN_ALLP_LEN_L = [224, 420, 856, 1089];
const IN_ALLP_LEN_R = [156, 520, 956, 1289];
const LOOP_ALLP_LEN = [2303, 2905, 3175, 2398];
const LOOP_DLY_LEN = [3423, 4589, 4365, 3698];

const TAP_OFFSET_L = [201, 145, 1897, 280];
const TAP_OFFSET_R = [1897, 1245, 487, 780];
const TAP_GAIN = [0.8, 0.7, 0.6, 0.5];

const DEFAULT_ALLP_COEFF = 0.65;
/** Scaled centre frequency of the treble loss filter in the loop. */
const HI_LOSS_FREQ = 0.3;
/** Scaled centre frequency of the bass loss filter in the loop. */
const LO_LOSS_FREQ = 0.06;
const MASTER_LOWPASS_F = 0.6;
const LFO1_FREQ_HZ = 1.37;
const LFO2_FREQ_HZ = 1.52;
const RV_TIME_K_MAX = 0.95;

/** Modulation depth is the top 5 bits of the 16-bit LFO, so +/-16 samples. */
const LFO_FRAC_BITS = 11;
const LFO_FRAC_MASK = (1 << LFO_FRAC_BITS) - 1;

/** 256-point signed 16-bit sine with a wrap entry, as in the reference table. */
const SINE = (() => {
  const t = new Int16Array(257);
  for (let i = 0; i < 257; i++) t[i] = Math.round(32767 * Math.sin((2 * Math.PI * i) / 256));
  return t;
})();

function mapfloat(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return ((v - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function makeBuffers(lengths: readonly number[]): Float32Array[] {
  return lengths.map((n) => new Float32Array(n));
}

export class PlateReverb {
  /** When bypassed the tail is flushed once, so it cannot resume later. */
  bypass = false;

  private inAllpL = makeBuffers(IN_ALLP_LEN_L);
  private inAllpR = makeBuffers(IN_ALLP_LEN_R);
  private loopAllp = makeBuffers(LOOP_ALLP_LEN);
  private loopDly = makeBuffers(LOOP_DLY_LEN);

  private inAllpIdxL = new Int32Array(4);
  private inAllpIdxR = new Int32Array(4);
  private loopAllpIdx = new Int32Array(4);
  private loopDlyIdx = new Int32Array(4);

  private lpf = new Float64Array(4);
  private hpf = new Float64Array(4);
  private loopAllpOut = 0;
  private masterLowpassL = 0;
  private masterLowpassR = 0;

  private inputAttn = 0.5;
  private inAllpK = DEFAULT_ALLP_COEFF;
  private loopAllpK = DEFAULT_ALLP_COEFF;
  private hiDampK = 1;
  private loDampK = 0;
  private lowpassF = HI_LOSS_FREQ;
  private hipassF = LO_LOSS_FREQ;
  private masterLowpassF = MASTER_LOWPASS_F;
  private rvTimeK = 0.2;
  private rvTimeScaler = 1;
  private level_ = 0;

  private lfo1Phase = 0;
  private lfo1Adder = 0;
  private lfo2Phase = 0;
  private lfo2Adder = 0;
  private flushed = false;

  constructor(sampleRate = 44100) {
    this.init(sampleRate);
  }

  init(sampleRate: number): void {
    // The reference computes this as (UINT32_MAX + 1) / (sr * hz), i.e. a 2^32
    // phase accumulator. Written out here because that expression overflows to
    // zero in C and silently disables the modulation.
    this.lfo1Adder = Math.round(4294967296 / (sampleRate * LFO1_FREQ_HZ));
    this.lfo2Adder = Math.round(4294967296 / (sampleRate * LFO2_FREQ_HZ));
    this.reset();
  }

  reset(): void {
    for (const b of this.inAllpL) b.fill(0);
    for (const b of this.inAllpR) b.fill(0);
    for (const b of this.loopAllp) b.fill(0);
    for (const b of this.loopDly) b.fill(0);
    this.inAllpIdxL.fill(0);
    this.inAllpIdxR.fill(0);
    this.loopAllpIdx.fill(0);
    this.loopDlyIdx.fill(0);
    this.lpf.fill(0);
    this.hpf.fill(0);
    this.loopAllpOut = 0;
    this.masterLowpassL = 0;
    this.masterLowpassR = 0;
    this.lfo1Phase = 0;
    this.lfo2Phase = 0;
  }

  /** Reverb time 0..1. Also attenuates the input, so long tails cannot clip. */
  setSize(n: number): void {
    const t = mapfloat(clamp01(n), 0, 1, 0.2, RV_TIME_K_MAX);
    this.rvTimeK = t;
    this.inputAttn = mapfloat(t, 0, RV_TIME_K_MAX, 0.5, 0.25);
  }

  /** High frequency loss in the tail, 0..1. */
  setHiDamp(n: number): void {
    this.hiDampK = 1 - clamp01(n);
  }

  /** Low frequency loss in the tail, 0..1. Also shortens the maximum reverb
   * time, which is the other half of why this reverb needs no limiter. */
  setLoDamp(n: number): void {
    const v = clamp01(n);
    this.loDampK = -v;
    this.rvTimeScaler = 1 - v * 0.12;
  }

  /** Master output lowpass 0..1, on a cubic taper. */
  setLowpass(n: number): void {
    const v = clamp01(n);
    this.masterLowpassF = mapfloat(v * v * v, 0, 1, 0.05, 1);
  }

  /** Allpass coefficient 0..1; lower settings make the tail more echoey. */
  setDiffusion(n: number): void {
    const k = mapfloat(clamp01(n), 0, 1, 0.005, 0.65);
    this.inAllpK = k;
    this.loopAllpK = k;
  }

  /** Wet return gain 0..1, applied by the caller when mixing the tail back in. */
  setLevel(n: number): void {
    this.level_ = clamp01(n);
  }

  get level(): number {
    return this.level_;
  }

  private allpass(bufs: Float32Array[], idx: Int32Array, n: number, input: number, k: number) {
    const buf = bufs[n];
    const i = idx[n];
    const acc = buf[i] + input * k;
    buf[i] = input - k * acc;
    idx[n] = i + 1 >= buf.length ? 0 : i + 1;
    return acc;
  }

  /** One loop stage: allpass, delay line, hi/lo shelving damper, time scaling. */
  private loopStage(n: number, input: number): number {
    let x = this.allpass(this.loopAllp, this.loopAllpIdx, n, input, this.loopAllpK);

    const dly = this.loopDly[n];
    const di = this.loopDlyIdx[n];
    const delayed = dly[di];
    dly[di] = x;
    this.loopDlyIdx[n] = di + 1 >= dly.length ? 0 : di + 1;
    x = delayed;

    this.lpf[n] += (x - this.lpf[n]) * this.lowpassF;
    const above = x - this.lpf[n];
    this.hpf[n] += (this.lpf[n] - this.hpf[n]) * this.hipassF;
    const shelved = this.lpf[n] + above * this.hiDampK + this.hpf[n] * this.loDampK;

    return shelved * this.rvTimeK * this.rvTimeScaler;
  }

  /** Read one interpolated, LFO-modulated tap out of a loop delay line. */
  private tap(n: number, offset: number, lfo: number, gain: number): number {
    const buf = this.loopDly[n];
    const len = buf.length;
    let i = (this.loopDlyIdx[n] + offset + (lfo >> LFO_FRAC_BITS)) % len;
    const a = buf[i];
    if (++i >= len) i = 0;
    const b = buf[i];
    const frac = (lfo & LFO_FRAC_MASK) / LFO_FRAC_MASK;
    return (a * (1 - frac) + b * frac) * gain;
  }

  /** Interpolated sine from the phase accumulator, as a signed 16-bit value. */
  private static lfoSin(phase: number): number {
    const idx = (phase >>> 24) & 0xff;
    const frac = phase & 0x00ffffff;
    const y = SINE[idx] * (0x00ffffff - frac) + SINE[idx + 1] * frac;
    return Math.floor(y / 0x1000000);
  }

  /**
   * Quarter-turn companion to `lfoSin`. The reference reuses the table index as
   * the interpolation fraction here, which leaves the cosine effectively
   * un-interpolated; kept as-is so the tail matches MiniDexed.
   */
  private static lfoCos(phase: number): number {
    const idx = ((phase >>> 24) + 64) & 0xff;
    const y = SINE[idx] * (0x00ffffff - idx) + SINE[idx + 1] * idx;
    return Math.floor(y / 0x1000000);
  }

  process(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    len: number,
  ): void {
    if (this.bypass) {
      if (!this.flushed) {
        this.reset();
        this.flushed = true;
      }
      outL.fill(0, 0, len);
      outR.fill(0, 0, len);
      return;
    }
    this.flushed = false;

    for (let i = 0; i < len; i++) {
      this.lfo1Phase = (this.lfo1Phase + this.lfo1Adder) >>> 0;
      this.lfo2Phase = (this.lfo2Phase + this.lfo2Adder) >>> 0;
      const lfo1Sin = PlateReverb.lfoSin(this.lfo1Phase);
      const lfo1Cos = PlateReverb.lfoCos(this.lfo1Phase);
      const lfo2Sin = PlateReverb.lfoSin(this.lfo2Phase);
      const lfo2Cos = PlateReverb.lfoCos(this.lfo2Phase);

      let x = inL[i] * this.inputAttn;
      for (let n = 0; n < 4; n++) {
        x = this.allpass(this.inAllpL, this.inAllpIdxL, n, x, this.inAllpK);
      }
      const inOutL = x;

      x = inR[i] * this.inputAttn;
      for (let n = 0; n < 4; n++) {
        x = this.allpass(this.inAllpR, this.inAllpIdxR, n, x, this.inAllpK);
      }
      const inOutR = x;

      // Figure-eight: the two input chains are injected alternately so the
      // channels cross-feed each other.
      let acc = this.loopStage(0, this.loopAllpOut + inOutR);
      acc = this.loopStage(1, acc + inOutL);
      acc = this.loopStage(2, acc + inOutR);
      this.loopAllpOut = this.loopStage(3, acc + inOutL);

      // Tap 1 is deliberately unmodulated; taps 2-4 ride the LFOs.
      let wetL = this.tap(0, TAP_OFFSET_L[0], 0, TAP_GAIN[0]);
      wetL += this.tap(1, TAP_OFFSET_L[1], lfo1Sin, TAP_GAIN[1]);
      wetL += this.tap(2, TAP_OFFSET_L[2], lfo2Cos, TAP_GAIN[2]);
      wetL += this.tap(3, TAP_OFFSET_L[3], lfo2Sin, TAP_GAIN[3]);
      this.masterLowpassL += (wetL - this.masterLowpassL) * this.masterLowpassF;
      outL[i] = this.masterLowpassL;

      let wetR = this.tap(0, TAP_OFFSET_R[0], 0, TAP_GAIN[0]);
      wetR += this.tap(1, TAP_OFFSET_R[1], lfo1Cos, TAP_GAIN[1]);
      wetR += this.tap(2, TAP_OFFSET_R[2], lfo2Sin, TAP_GAIN[2]);
      // The reference drives this tap's read position from lfo1 but its
      // interpolation fraction from lfo2, which is an inconsistency rather than
      // a design choice; both come from lfo1 here.
      wetR += this.tap(3, TAP_OFFSET_R[3], lfo1Sin, TAP_GAIN[3]);
      this.masterLowpassR += (wetR - this.masterLowpassR) * this.masterLowpassF;
      outR[i] = this.masterLowpassR;
    }
  }
}
