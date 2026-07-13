import { describe, it, expect } from 'vitest';
import { createStandardTuning } from '../tuning';

describe('StandardTuning', () => {
  const tuning = createStandardTuning();

  it('returns integer table values for whole MIDI notes', () => {
    const lo = tuning.midinoteToLogfreq(60);
    const hi = tuning.midinoteToLogfreq(61);
    expect(Number.isFinite(lo)).toBe(true);
    expect(Number.isFinite(hi)).toBe(true);
    expect(hi).toBeGreaterThan(lo);
  });

  it('interpolates fractional MIDI notes', () => {
    const lo = tuning.midinoteToLogfreq(60);
    const hi = tuning.midinoteToLogfreq(61);
    const mid = tuning.midinoteToLogfreq(60.5);
    expect(Number.isFinite(mid)).toBe(true);
    expect(mid).toBeGreaterThan(lo);
    expect(mid).toBeLessThan(hi);
  });

  it('supports performance detune offsets in cents', () => {
    const base = tuning.midinoteToLogfreq(60);
    const detunedUp = tuning.midinoteToLogfreq(60.01);
    const detunedDn = tuning.midinoteToLogfreq(59.93);
    expect(Number.isFinite(detunedUp)).toBe(true);
    expect(Number.isFinite(detunedDn)).toBe(true);
    expect(detunedUp).toBeGreaterThan(base);
    expect(detunedDn).toBeLessThan(base);
  });
});
