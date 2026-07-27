import { describe, it, expect } from 'vitest';
import { Compressor } from '../compressor';
import { log2Approx, log10Approx, pow10Approx } from '../approx';

const SR = 44100;

function sine(hz: number, n: number, amp: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

function peak(buf: Float32Array, from = 0): number {
  let p = 0;
  for (let i = from; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
  return p;
}

/**
 * Steady-state gain applied to a sustained tone at the given amplitude. The
 * envelope follower starts at full scale, so this runs three seconds of tone to
 * let the 200 ms release walk that startup transient off before measuring.
 */
function settledGain(amp: number): number {
  const comp = new Compressor(SR);
  const buf = sine(440, SR * 3, amp);
  comp.process(buf, buf.length);
  return peak(buf, buf.length - 4410) / amp;
}

describe('log approximations', () => {
  it('tracks log2 closely enough for level detection', () => {
    for (let e = -40; e <= 4; e++) {
      for (const m of [1, 1.3, 1.7]) {
        const x = m * 2 ** e;
        expect(Math.abs(log2Approx(x) - Math.log2(x))).toBeLessThan(0.005);
      }
    }
  });

  it('is finite at zero rather than diverging', () => {
    expect(Number.isFinite(log2Approx(0))).toBe(true);
    expect(Number.isFinite(log10Approx(0))).toBe(true);
  });

  it('round-trips through pow10', () => {
    for (const x of [-3, -1, -0.25, 0, 0.5, 2]) {
      expect(pow10Approx(x)).toBeCloseTo(10 ** x, 6);
    }
  });
});

describe('Compressor', () => {
  it('leaves signals below the threshold alone', () => {
    // -20 dBFS is 0.1; well under that nothing should move.
    expect(settledGain(0.01)).toBeCloseTo(1, 2);
  });

  it('attenuates above the threshold', () => {
    expect(settledGain(1)).toBeLessThan(0.5);
  });

  it('attenuates more as the input gets louder', () => {
    expect(settledGain(1)).toBeLessThan(settledGain(0.3));
  });

  it('follows the 5:1 ratio above the threshold', () => {
    // The detector measures mean power, so a full-scale sine reads -3 dBFS,
    // which is 17 dB over the threshold. At 5:1 that is 17 * 0.8 = 13.6 dB down.
    const reduction = 20 * Math.log10(settledGain(1));
    expect(reduction).toBeGreaterThan(-14.5);
    expect(reduction).toBeLessThan(-12.5);
  });

  it('never boosts', () => {
    const comp = new Compressor(SR);
    const buf = sine(440, 8192, 0.02);
    comp.process(buf, buf.length);
    expect(peak(buf)).toBeLessThanOrEqual(0.0201);
    expect(comp.gainReductionDb).toBeLessThanOrEqual(0);
  });

  it('attacks faster than it releases', () => {
    const comp = new Compressor(SR);
    const loud = sine(440, Math.round(SR * 0.05), 1);
    comp.process(loud, loud.length);
    const attacked = comp.gainReductionDb;

    // A tenth of a second of quiet is long against the 5 ms attack but short
    // against the 200 ms release, so most of the reduction should remain.
    const quiet = new Float32Array(Math.round(SR * 0.1));
    comp.process(quiet, quiet.length);
    expect(comp.gainReductionDb).toBeGreaterThan(attacked);
    expect(comp.gainReductionDb).toBeLessThan(attacked * 0.2);
  });

  it('removes DC through the highpass prefilter', () => {
    const comp = new Compressor(SR);
    const buf = new Float32Array(SR).fill(0.05);
    comp.process(buf, buf.length);
    expect(Math.abs(buf[buf.length - 1])).toBeLessThan(0.001);
  });
});
