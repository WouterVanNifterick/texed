import { describe, it, expect } from 'vitest';
import {
  decodeMicrotuning,
  encodeMicrotuning,
  equalTemperamentUnits,
} from '@texed/dx7-format/microtuning';
import { createStandardTuning, createMicroTuning } from '../tuning';
import { SynthRack } from '../synth-rack';

const OCTAVE_Q24 = 1 << 24;

describe('microtuning decode', () => {
  it('round-trips encode/decode of 128 per-key units', () => {
    const units = equalTemperamentUnits();
    const back = decodeMicrotuning(encodeMicrotuning(units));
    expect(back).not.toBeNull();
    expect(Array.from(back!)).toEqual(Array.from(units));
  });

  it('rejects an undersized blob', () => {
    expect(decodeMicrotuning(new Uint8Array(10))).toBeNull();
  });

  it('equal-temperament table reproduces StandardTuning within the format quantization', () => {
    const std = createStandardTuning();
    const micro = createMicroTuning(equalTemperamentUnits());
    let maxCents = 0;
    for (let n = 0; n < 128; n++) {
      const diff = Math.abs(micro.midinoteToLogfreq(n) - std.midinoteToLogfreq(n));
      maxCents = Math.max(maxCents, (diff / OCTAVE_Q24) * 1200);
    }
    // 1/1024-octave resolution → ≤ ~0.4 cents; anything under a cent is inaudible.
    expect(maxCents).toBeLessThan(1);
    expect(micro.isStandardTuning()).toBe(false);
  });

  it('carries the master-tune offset into a micro-tuning table', () => {
    const micro = createMicroTuning(equalTemperamentUnits());
    const before = micro.midinoteToLogfreq(69);
    micro.setMasterTuneCents(50);
    const after = micro.midinoteToLogfreq(69);
    // +50 cents ≈ half a semitone up in Q24/octave units.
    expect((after - before) / OCTAVE_Q24).toBeCloseTo(50 / 1200, 4);
  });
});

describe('SynthRack micro-tuning selection', () => {
  it('activates a loaded table, reflects it in settings, and round-trips through RackState', () => {
    const rack = new SynthRack(44100);
    rack.voiceLibrary.microtunings.push(encodeMicrotuning(equalTemperamentUnits()));

    expect(rack.getMicrotuningNames()).toEqual(['Micro 1']);
    rack.setMicrotuning(0);
    expect(rack.getGlobalSettings().microtuning).toBe(0);

    const fresh = new SynthRack(44100);
    fresh.restoreFullState(rack.getFullState());
    expect(fresh.getGlobalSettings().microtuning).toBe(0);
    expect(fresh.getMicrotuningNames()).toEqual(['Micro 1']);
    expect(fresh.voiceLibrary.microtunings).toHaveLength(1);
  });

  it('falls back to standard tuning for an out-of-range index', () => {
    const rack = new SynthRack(44100);
    rack.setMicrotuning(5); // nothing loaded
    expect(rack.getGlobalSettings().microtuning).toBe(-1);
  });
});
