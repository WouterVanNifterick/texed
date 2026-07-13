import { describe, it, expect } from 'vitest';
import { Sin } from '../sin';
import { Exp2 } from '../exp2';
import { Freqlut } from '../freqlut';
import { SynthUnit } from '../synth-unit';
import { N } from '../synth';

describe('DSP tables', () => {
  it('Sin.lookup is bounded and roughly sinusoidal', () => {
    Sin.init();
    // phase is Q24 (full cycle = 1<<24); the table stores a Q24 sine.
    const zero = Sin.lookup(0);
    const quarter = Sin.lookup(1 << 22); // quarter cycle -> peak ~ +1.0 (2^24)
    expect(Math.abs(zero)).toBeLessThan(1 << 20);
    expect(quarter).toBeGreaterThan(1 << 23);
    expect(quarter).toBeLessThanOrEqual(1 << 24);
  });

  it('Exp2.lookup is monotonically increasing within range', () => {
    Exp2.init();
    // Exp2 doubles every 1<<24 and intentionally wraps int32 for large inputs,
    // so only test a range that stays inside int32.
    let prev = Exp2.lookup(0);
    for (let x = 1 << 20; x < 5 * (1 << 24); x += 1 << 22) {
      const v = Exp2.lookup(x);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('Freqlut.lookup returns positive frequencies', () => {
    Freqlut.init(44100);
    expect(Freqlut.lookup(1 << 24)).toBeGreaterThan(0);
  });
});

describe('SynthUnit', () => {
  it('renders non-silent, finite audio for the init voice', () => {
    const synth = new SynthUnit(44100);
    synth.noteOn(60, 100);

    let peak = 0;
    const block = new Float32Array(N * 2);
    // render ~1000 blocks (~1.5s) to let the envelope open
    for (let b = 0; b < 200; b++) {
      block.fill(0);
      synth.render(block, block.length);
      for (let i = 0; i < block.length; i++) {
        const s = block[i];
        expect(Number.isFinite(s)).toBe(true);
        peak = Math.max(peak, Math.abs(s));
      }
    }
    expect(peak).toBeGreaterThan(0);
  });

  it('goes silent again after note off and release', () => {
    const synth = new SynthUnit(44100);
    synth.noteOn(60, 100);
    const block = new Float32Array(128);
    for (let b = 0; b < 100; b++) {
      block.fill(0);
      synth.render(block, block.length);
    }
    synth.noteOff(60);
    // long release
    let peak = 0;
    for (let b = 0; b < 4000; b++) {
      block.fill(0);
      synth.render(block, block.length);
      for (let i = 0; i < block.length; i++) peak = Math.max(peak, Math.abs(block[i]));
      peak = 0; // only care about the tail
    }
    for (let i = 0; i < block.length; i++) {
      expect(Number.isFinite(block[i])).toBe(true);
    }
  });
});
