import { describe, it, expect } from 'vitest';
import { PluginFx } from '../plugin-fx';
import { atanApprox } from '../approx';

const SR = 44100;

function sine(hz: number, n: number, amp = 1): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

function makeFx(patch: Partial<Pick<PluginFx, 'cutoff' | 'resonance' | 'gain' | 'dcBlock'>> = {}) {
  const fx = new PluginFx();
  fx.init(SR);
  Object.assign(fx, patch);
  return fx;
}

describe('atanApprox', () => {
  it('matches Math.atan more closely than float precision', () => {
    for (let x = -50; x <= 50; x += 0.013) {
      expect(Math.abs(atanApprox(x) - Math.atan(x))).toBeLessThan(1e-7);
    }
  });

  it('is exact at zero and odd-symmetric', () => {
    expect(atanApprox(0)).toBe(0);
    for (const x of [0.1, 0.9, 1, 3, 100]) {
      expect(atanApprox(-x)).toBeCloseTo(-atanApprox(x), 12);
    }
  });
});

describe('PluginFx', () => {
  it('leaves the signal untouched at defaults with DC blocking off', () => {
    const fx = makeFx({ dcBlock: false });
    const input = sine(440, 512);
    const work = input.slice();
    fx.process(work, work.length);
    expect(Array.from(work)).toEqual(Array.from(input));
  });

  it('removes DC when blocking is on', () => {
    const fx = makeFx();
    const work = new Float32Array(4096).fill(0.5);
    // The blocker is a one-pole at ~2 Hz, so give it time to settle.
    for (let i = 0; i < 8; i++) fx.process(work.subarray(0, 512), 512);
    fx.process(work, work.length);
    expect(Math.abs(work[work.length - 1])).toBeLessThan(0.01);
  });

  it('attenuates above the cutoff and passes below it', () => {
    const low = makeFx({ dcBlock: false, cutoff: 0.5 });
    const high = makeFx({ dcBlock: false, cutoff: 0.5 });

    const lowIn = sine(200, 4096);
    const highIn = sine(12000, 4096);
    low.process(lowIn, lowIn.length);
    high.process(highIn, highIn.length);

    expect(rms(lowIn)).toBeGreaterThan(0.4);
    expect(rms(highIn)).toBeLessThan(rms(lowIn) * 0.25);
  });

  it('peaks at the cutoff as resonance rises', () => {
    // logsc(0.5, 60, 19000) with the rolloff of 19 lands near 3.5 kHz. The
    // makeup gain flattens the passband, so resonance shows up as the ratio
    // between the corner and well below it, not as raw level.
    const gainAt = (resonance: number, hz: number) => {
      const fx = makeFx({ dcBlock: false, cutoff: 0.5, resonance });
      const buf = sine(hz, 8192, 0.25);
      fx.process(buf, buf.length);
      return rms(buf.subarray(4096));
    };
    const flat = gainAt(0, 3500) / gainAt(0, 440);
    const resonant = gainAt(0.9, 3500) / gainAt(0.9, 440);
    expect(resonant).toBeGreaterThan(flat * 2);
  });

  it('ramps gain instead of stepping it', () => {
    const fx = makeFx({ dcBlock: false });
    const rampSamples = Math.ceil(SR / 10); // 100 ms for a full-scale change

    fx.gain = 0;
    const first = new Float32Array(64).fill(1);
    fx.process(first, first.length);
    // A step would have silenced the block outright.
    expect(first[0]).toBeGreaterThan(0.99);
    expect(first[first.length - 1]).toBeGreaterThan(0.9);

    const rest = new Float32Array(rampSamples).fill(1);
    fx.process(rest, rest.length);
    expect(Math.abs(rest[rest.length - 1])).toBeLessThan(1e-6);
  });

  it('holds steady once the ramp reaches its target', () => {
    const fx = makeFx({ dcBlock: false });
    fx.gain = 0.5;
    const settle = new Float32Array(SR).fill(1);
    fx.process(settle, settle.length);

    const work = new Float32Array(64).fill(1);
    fx.process(work, work.length);
    for (const v of work) expect(v).toBeCloseTo(0.5, 6);
  });
});
