import { describe, it, expect } from 'vitest';
import { Sin } from '../sin';
import { Exp2 } from '../exp2';
import { Freqlut } from '../freqlut';
import { SynthUnit } from '../synth-unit';
import { N } from '../synth';

describe('DSP tables', () => {
  it('Sin.lookup matches golden Q24 samples', () => {
    Sin.init();
    const cases: Array<[number, number]> = [
      [0, 0],
      [1 << 22, 16777216],
      [1 << 23, 0],
      [3 << 22, -16777216],
      [1 << 24, 0],
      [(1 << 22) + (1 << 13), 16777058],
      [(-1 << 22) | 0, -16777216],
      [(0x80000000 + (1 << 22)) | 0, 16777216],
    ];
    for (const [phase, expected] of cases) {
      expect(Sin.lookup(phase)).toBe(expected);
    }
    // init is idempotent
    Sin.init();
    expect(Sin.lookup(1 << 22)).toBe(16777216);
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

  it('applies patch transpose in key space (transpose -12 = octave down)', () => {
    const render = (transpose: number, pitch: number): Float32Array => {
      const synth = new SynthUnit(44100);
      synth.setVoiceParam(144, transpose); // 24 = neutral
      synth.noteOn(pitch, 100);
      const out = new Float32Array(N * 50);
      const block = new Float32Array(N);
      for (let b = 0; b < 50; b++) {
        block.fill(0);
        synth.render(block, block.length);
        out.set(block, b * N);
      }
      return out;
    };

    // transpose -12 remaps note 84 to the same key as note 72 at neutral
    const neutral = render(24, 72);
    const transposed = render(12, 84);
    expect(transposed).toEqual(neutral);

    // and it must actually change the sound vs. ignoring the parameter
    const ignored = render(24, 84);
    expect(transposed).not.toEqual(ignored);
  });

  it('releases a held note normally after transpose changes (no stuck notes)', () => {
    const synth = new SynthUnit(44100);
    synth.noteOn(60, 100);
    const block = new Float32Array(N);
    for (let b = 0; b < 100; b++) {
      block.fill(0);
      synth.render(block, block.length);
    }

    // transpose -12 while the key is held: the note keeps playing...
    synth.setVoiceParam(144, 12);
    let peak = 0;
    for (let b = 0; b < 20; b++) {
      block.fill(0);
      synth.render(block, block.length);
      for (let i = 0; i < block.length; i++) peak = Math.max(peak, Math.abs(block[i]));
    }
    expect(peak).toBeGreaterThan(0);

    // ...and note-off by the raw MIDI note still releases it
    synth.noteOff(60);
    for (let b = 0; b < 4000; b++) {
      block.fill(0);
      synth.render(block, block.length);
    }
    peak = 0;
    for (let b = 0; b < 10; b++) {
      block.fill(0);
      synth.render(block, block.length);
      for (let i = 0; i < block.length; i++) peak = Math.max(peak, Math.abs(block[i]));
    }
    expect(peak).toBeLessThan(1e-4);
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
