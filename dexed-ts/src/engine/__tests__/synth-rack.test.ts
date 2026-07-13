import { describe, it, expect } from 'vitest';
import { SynthRack } from '../synth-rack';
import { N } from '../synth';

const peak = (buf: Float32Array): number => {
  let p = 0;
  for (const s of buf) p = Math.max(p, Math.abs(s));
  return p;
};

const renderPeak = (rack: SynthRack, blocks: number): { l: number; r: number } => {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let l = 0;
  let r = 0;
  for (let b = 0; b < blocks; b++) {
    L.fill(0);
    R.fill(0);
    rack.render(L, R, N);
    l = Math.max(l, peak(L));
    r = Math.max(r, peak(R));
  }
  return { l, r };
};

describe('SynthRack', () => {
  it('behaves like a single omni part by default', () => {
    const rack = new SynthRack(44100);
    rack.noteOn(60, 100, 1);
    const { l, r } = renderPeak(rack, 200);
    expect(l).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(0);
    // Center pan by default -> both channels roughly equal.
    expect(Math.abs(l - r)).toBeLessThan(l * 0.05 + 1e-6);
  });

  it('routes notes to parts by receive channel', () => {
    const rack = new SynthRack(44100);
    rack.setPartConfig(0, { enabled: true, rxChannel: 1 });
    rack.setPartConfig(1, { enabled: true, rxChannel: 2 });

    // A note on channel 3 matches neither part -> silence.
    rack.noteOn(60, 100, 3);
    expect(renderPeak(rack, 50).l).toBe(0);

    // A note on channel 2 sounds.
    rack.noteOn(60, 100, 2);
    expect(renderPeak(rack, 100).l).toBeGreaterThan(0);
  });

  it('honors per-part note range splits', () => {
    const rack = new SynthRack(44100);
    rack.setPartConfig(0, { enabled: true, rxChannel: 0, noteLow: 0, noteHigh: 59 });
    rack.setPartConfig(1, { enabled: true, rxChannel: 0, noteLow: 60, noteHigh: 127 });

    // Below the split -> part 0 sounds.
    rack.noteOn(48, 100, 1);
    expect(renderPeak(rack, 100).l).toBeGreaterThan(0);

    // A note outside every part's range is silent (fresh rack, no FX tail).
    const rack2 = new SynthRack(44100);
    rack2.setPartConfig(0, { enabled: true, rxChannel: 0, noteLow: 0, noteHigh: 40 });
    rack2.setPartConfig(1, { enabled: true, rxChannel: 0, noteLow: 80, noteHigh: 127 });
    rack2.noteOn(60, 100, 1);
    expect(renderPeak(rack2, 50).l).toBeLessThan(1e-6);
  });

  it('pans a part hard right', () => {
    const rack = new SynthRack(44100);
    rack.setPartConfig(0, { pan: 1 });
    rack.noteOn(60, 100, 1);
    const { l, r } = renderPeak(rack, 200);
    expect(r).toBeGreaterThan(0);
    expect(l).toBeLessThan(r * 0.01 + 1e-6);
  });

  it('caps total polyphony across parts by stealing', () => {
    const rack = new SynthRack(44100);
    rack.setPolyphonyCap(4);
    for (let n = 60; n < 80; n++) rack.noteOn(n, 100, 1);
    // Let envelopes open, then confirm no more than the cap are sounding.
    renderPeak(rack, 20);
    const status = rack.getStatus();
    expect(status.totalActive).toBeLessThanOrEqual(4);
  });

  it('stops all voices on panic', () => {
    const rack = new SynthRack(44100);
    rack.noteOn(60, 100, 1);
    const before = renderPeak(rack, 50).l;
    expect(before).toBeGreaterThan(0);
    rack.panic();
    expect(rack.getStatus().totalActive).toBe(0);
    // Audio decays toward silence (the global FX filter rings briefly).
    const after = renderPeak(rack, 200).l;
    expect(after).toBeLessThan(before * 0.5);
  });
});
