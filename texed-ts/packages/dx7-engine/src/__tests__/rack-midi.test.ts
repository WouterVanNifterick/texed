// Rack-level MIDI input: the controllers that address the mixer rather than a
// voice, program change across banks, and the three hold pedals.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SynthRack } from '../synth-rack';
import { N } from '../synth';
import { loadSysexFile } from '@texed/dx7-format/sysex-loader';

const here = dirname(fileURLToPath(import.meta.url));

const loadRom = (rack: SynthRack): void => {
  const result = loadSysexFile(new Uint8Array(readFileSync(join(here, 'fixtures', 'rom1a.syx'))));
  expect(result.loaded).toBe(true);
  rack.loadLibrary(result.library);
};

const peak = (rack: SynthRack, blocks: number): number => {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let p = 0;
  for (let b = 0; b < blocks; b++) {
    L.fill(0);
    R.fill(0);
    rack.render(L, R, N);
    for (let i = 0; i < N; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
  }
  return p;
};

describe('rack control changes', () => {
  it('maps the mixer controllers onto the part config', () => {
    const rack = new SynthRack(44100);
    rack.controlChange(7, 64, 1);
    rack.controlChange(10, 0, 1);
    rack.controlChange(74, 32, 1);
    rack.controlChange(71, 127, 1);
    rack.controlChange(91, 127, 1);

    const cfg = rack.getPartConfigs()[0];
    expect(cfg.volume).toBeCloseTo(64 / 127);
    expect(cfg.pan).toBeCloseTo(-1);
    expect(cfg.cutoff).toBeCloseTo(32 / 127);
    expect(cfg.resonance).toBe(1);
    expect(cfg.reverbSend).toBe(1);
  });

  it('reports mixer changes so the UI can refresh, but not voice controllers', () => {
    const rack = new SynthRack(44100);
    expect(rack.controlChange(7, 100, 1)).toBe(true);
    expect(rack.controlChange(1, 100, 1)).toBe(false);
  });

  it('restores the previous channel when omni is switched back off', () => {
    const rack = new SynthRack(44100);
    rack.setPartConfig(0, { rxChannel: 5 });
    rack.controlChange(125, 0, 5); // omni on
    expect(rack.getPartConfigs()[0].rxChannel).toBe(0);
    rack.controlChange(124, 0, 9); // omni off, on any channel now
    expect(rack.getPartConfigs()[0].rxChannel).toBe(5);
  });

  it('selects a bank from the CC 0 / CC 32 pair', () => {
    const rack = new SynthRack(44100);
    rack.controlChange(0, 0, 1);
    rack.controlChange(32, 1, 1);
    expect(rack.getPartConfigs()[0].voice.bank).toBe('internalB');

    // Past the four half-banks there is nothing to select, so nothing moves.
    rack.controlChange(32, 9, 1);
    expect(rack.getPartConfigs()[0].voice.bank).toBe('internalB');
  });
});

describe('program change', () => {
  it('expands across banks: the top two bits step forward from the current one', () => {
    const rack = new SynthRack(44100);
    rack.programChange(5, 1);
    expect(rack.getPartConfigs()[0].voice).toEqual({ bank: 'internalA', program: 5 });

    rack.programChange(32 + 7, 1);
    expect(rack.getPartConfigs()[0].voice).toEqual({ bank: 'internalB', program: 7 });

    // internalB + 3 would be past cartridgeB, so the part keeps its voice.
    rack.programChange(96, 1);
    expect(rack.getPartConfigs()[0].voice).toEqual({ bank: 'internalB', program: 7 });
  });

  it('only reaches parts listening on the channel', () => {
    const rack = new SynthRack(44100);
    rack.setPartConfig(0, { enabled: true, rxChannel: 1 });
    rack.setPartConfig(1, { enabled: true, rxChannel: 2 });
    rack.programChange(9, 2);
    expect(rack.getPartConfigs()[0].voice.program).toBe(0);
    expect(rack.getPartConfigs()[1].voice.program).toBe(9);
  });
});

describe('hold pedals', () => {
  const held = (setup: (rack: SynthRack) => void): boolean => {
    const rack = new SynthRack(44100);
    loadRom(rack);
    setup(rack);
    return peak(rack, 60) > 1e-4;
  };

  it('sustain (CC 64) holds a released note and lets go when it lifts', () => {
    expect(
      held((r) => {
        r.controlChange(64, 127, 1);
        r.noteOn(60, 100, 1);
        peak(r, 20);
        r.noteOff(60, 1);
      }),
    ).toBe(true);

    expect(
      held((r) => {
        r.controlChange(64, 127, 1);
        r.noteOn(60, 100, 1);
        peak(r, 20);
        r.noteOff(60, 1);
        r.controlChange(64, 0, 1);
        peak(r, 400);
      }),
    ).toBe(false);
  });

  it('sostenuto (CC 66) holds only the keys that were down when it engaged', () => {
    const rack = new SynthRack(44100);
    loadRom(rack);
    rack.noteOn(60, 100, 1);
    peak(rack, 20);
    rack.controlChange(66, 127, 1);
    rack.noteOn(67, 100, 1);
    peak(rack, 20);

    // The later note is not captured, so its release runs to silence...
    rack.noteOff(67, 1);
    peak(rack, 400);
    expect(peak(rack, 60)).toBeGreaterThan(1e-4);

    // ...while the captured one keeps ringing until the pedal lifts.
    rack.noteOff(60, 1);
    peak(rack, 400);
    expect(peak(rack, 60)).toBeGreaterThan(1e-4);
    rack.controlChange(66, 0, 1);
    peak(rack, 400);
    expect(peak(rack, 60)).toBeLessThan(1e-4);
  });

  it('hold-2 (CC 69) releases on the next phrase rather than when the pedal lifts', () => {
    const rack = new SynthRack(44100);
    loadRom(rack);
    rack.controlChange(69, 127, 1);
    rack.noteOn(60, 100, 1);
    rack.noteOff(60, 1);
    peak(rack, 400);
    expect(rack.getStatus().totalActive).toBe(1);

    // A fresh key-down with nothing else held ends the held note's life; the
    // new note stays, because the pedal is still down under it.
    rack.noteOn(72, 100, 1);
    peak(rack, 400);
    expect(rack.getStatus().totalActive).toBe(1);
  });
});
