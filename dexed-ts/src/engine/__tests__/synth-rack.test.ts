import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SynthRack } from '../synth-rack';
import { loadSysexFile } from '../sysex-loader';
import { N } from '../synth';

const here = dirname(fileURLToPath(import.meta.url));
const loadRom = (rack: SynthRack): void => {
  const result = loadSysexFile(new Uint8Array(readFileSync(join(here, 'fixtures', 'rom1a.syx'))));
  expect(result.loaded).toBe(true);
  rack.loadLibrary(result.library);
};

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

  it('honors inverted per-part note ranges', () => {
    const rack = new SynthRack(44100);
    rack.setPartConfig(0, { enabled: true, rxChannel: 0, noteLow: 80, noteHigh: 40 });

    rack.noteOn(60, 100, 1);
    expect(renderPeak(rack, 50).l).toBeLessThan(1e-6);

    rack.noteOff(60, 1);
    rack.noteOn(30, 100, 1);
    expect(renderPeak(rack, 100).l).toBeGreaterThan(0);

    rack.noteOff(30, 1);
    rack.noteOn(100, 100, 1);
    expect(renderPeak(rack, 100).l).toBeGreaterThan(0);
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

  it('loads voice data when a voice ref is set via setPartConfig', () => {
    const rack = new SynthRack(44100);
    loadRom(rack);

    const prog0 = rack.getVoiceData(1);
    rack.setPartConfig(1, { voice: { bank: 'internalA', program: 5 } });
    const prog5 = rack.getVoiceData(1);
    expect(prog5).not.toEqual(prog0);

    rack.setPartConfig(1, { voice: { bank: 'internalA', program: 0 } });
    expect(rack.getVoiceData(1)).toEqual(rack.getVoiceData(0));
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

  it('plays after selecting a TX802 performance with omni routing', () => {
    const rack = new SynthRack(44100);
    const result = loadSysexFile(new Uint8Array(readFileSync(join(here, 'fixtures', 'tx802-prg1.syx'))));
    expect(result.loaded).toBe(true);
    rack.loadLibrary(result.library);

    rack.noteOn(60, 100, 1);
    expect(renderPeak(rack, 100).l).toBeGreaterThan(0);
  });

  it.each([-7, -1, 1, 7])('produces audio with part detune %i cents', (detune) => {
    const rack = new SynthRack(44100);
    rack.setPartConfig(0, { detune });
    rack.noteOn(60, 100, 1);
    expect(renderPeak(rack, 200).l).toBeGreaterThan(0);
  });

  it('releases a held note after switching voice via setVoiceRef', () => {
    const rack = new SynthRack(44100);
    loadRom(rack);

    rack.noteOn(60, 100, 1);
    expect(renderPeak(rack, 50).l).toBeGreaterThan(0);

    rack.setVoiceRefForPart(0, { bank: 'internalA', program: 5 });
    rack.noteOff(60, 1);
    renderPeak(rack, 4000);
    expect(rack.getStatus().totalActive).toBe(0);
    expect(renderPeak(rack, 10).l).toBeLessThan(1e-4);
  });

  it('silences held notes immediately when switching voice (no explicit note-off)', () => {
    const rack = new SynthRack(44100);
    loadRom(rack);

    rack.noteOn(60, 100, 1);
    const before = renderPeak(rack, 50).l;
    expect(before).toBeGreaterThan(0);

    rack.setVoiceRefForPart(0, { bank: 'internalA', program: 5 });
    expect(rack.getStatus().totalActive).toBe(0);
    const after = renderPeak(rack, 200).l;
    expect(after).toBeLessThan(before * 0.5);
  });

  it('clears unison voices when switching voice while held', () => {
    const rack = new SynthRack(44100);
    loadRom(rack);

    rack.setSupplementParamForPart(0, 5, 0x08 | 0x02); // unison on
    rack.noteOn(60, 100, 1);
    renderPeak(rack, 10);
    expect(rack.getStatus().totalActive).toBe(2);

    rack.setVoiceRefForPart(0, { bank: 'internalA', program: 3 });
    expect(rack.getStatus().totalActive).toBe(0);
  });
});
