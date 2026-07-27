import { describe, it, expect } from 'vitest';
import { initVoice } from '@texed/dx7-format/cartridge';
import { createDefaultAmem, VoiceSupplement } from '@texed/dx7-format/amem';
import { G, opBase, OP } from '@texed/dx7-format/voice';
import { Controllers, applySupplementToControllers } from '../controllers';
import { Lfo } from '../lfo';
import { SynthRack } from '../synth-rack';
import { setEngineAccuracy } from '../synth-unit';
import { N } from '../synth';

/** Same fold Dx7Note.compute uses for delay-scaled patch PMD. */
function delayedPmdFactor(pitchmoddepth: number, lfoDelay: number): number {
  return (pitchmoddepth * lfoDelay) >>> 24;
}

function vibratoVoice(delay: number): Uint8Array {
  const v = initVoice();
  for (let op = 1; op <= 6; op++) v[opBase(op) + OP.outputLevel] = op === 1 ? 99 : 0;
  v[G.lfoSpeed] = 50;
  v[G.lfoDelay] = delay;
  v[G.lfoPmd] = 99;
  v[G.pitchModSens] = 7;
  v[G.lfoWave] = 3;
  for (let i = 0; i < 4; i++) {
    v[G.pitchEgRate(i)] = 99;
    v[G.pitchEgLevel(i)] = 50;
  }
  return v;
}

function estimateFreq(buf: Float32Array, sr = 44100): number {
  const minP = Math.floor(sr / 800);
  const maxP = Math.floor(sr / 80);
  let best = 0;
  let bestC = -1;
  for (let p = minP; p <= maxP; p++) {
    let c = 0;
    for (let i = 0; i < buf.length - p; i++) c += buf[i] * buf[i + p];
    if (c > bestC) {
      bestC = c;
      best = p;
    }
  }
  return sr / best;
}

describe('LFO delay × PMD fold', () => {
  it('keeps full patch depth at the end of the delay ramp', () => {
    const depth = 255; // PMD 99 → (99 * 165) >> 6
    expect(delayedPmdFactor(depth, 0)).toBe(0);
    expect(delayedPmdFactor(depth, 1 << 24)).toBe(255);
    // Signed >> wraps here; that is the bug this guards against.
    expect((depth * (1 << 24)) >> 24).toBe(-1);
  });

  it('holds then fades for a high delay setting', () => {
    setEngineAccuracy('hardware');
    Lfo.init(44100);
    const lfo = new Lfo();
    lfo.reset([50, 99, 0, 0, 0, 0]);
    lfo.keydown();

    let holdBlocks = 0;
    while (lfo.getdelay() === 0 && holdBlocks < 1_000_000) holdBlocks++;
    // delay 99 ≈ 2.7s hold at 44.1 kHz (N=64 → ~1900 blocks).
    const holdSec = (holdBlocks * N) / 44100;
    expect(holdSec).toBeGreaterThan(2);
    expect(holdSec).toBeLessThan(4);

    let fade = lfo.getdelay();
    expect(fade).toBeGreaterThan(0);
    expect(fade).toBeLessThan(1 << 24);
    for (let i = 0; i < 200_000 && fade < 1 << 24; i++) fade = lfo.getdelay();
    expect(fade).toBe(1 << 24);
  });
});

describe('LFO delay vs controller defaults', () => {
  it('does not apply FC2/MIDI-ctrl pitch mod until that CC is received', () => {
    const amem = createDefaultAmem();
    amem[26] = 99; // foot2 pitch
    amem[30] = 99; // midi-ctrl pitch
    const ctrls = new Controllers();
    applySupplementToControllers(new VoiceSupplement(amem), ctrls);

    expect(ctrls.foot2Cc).toBe(127);
    expect(ctrls.midiCsCc).toBe(127);
    expect(ctrls.pitchMod).toBe(0);

    ctrls.foot2Seen = true;
    ctrls.refresh();
    expect(ctrls.pitchMod).toBe(Math.trunc(127 * 0.99));
  });

  it('keeps pitch stable during delay even when FC2 has a pitch range in AMEM', () => {
    const amem = createDefaultAmem();
    amem[26] = 99; // would have caused immediate vibrato with the old defaults
    const rack = new SynthRack(44100);
    rack.loadVoiceForPart(0, vibratoVoice(99), amem);

    const L = new Float32Array(N);
    const R = new Float32Array(N);
    for (let i = 0; i < 200; i++) rack.render(L, R, N);
    rack.noteOn(60, 110);

    const freqs: number[] = [];
    for (let w = 0; w < 6; w++) {
      const buf = new Float32Array(32 * N);
      for (let i = 0; i < 32; i++) {
        rack.render(L, R, N);
        buf.set(L, i * N);
      }
      freqs.push(estimateFreq(buf));
    }
    const mean = freqs.reduce((a, b) => a + b, 0) / freqs.length;
    const std = Math.sqrt(freqs.reduce((a, b) => a + (b - mean) ** 2, 0) / freqs.length);
    expect(std).toBeLessThan(1);
  });

  it('restarts the delay ramp when DELAY is edited live', () => {
    setEngineAccuracy('hardware');
    Lfo.init(44100);
    const rack = new SynthRack(44100);
    rack.loadVoiceForPart(0, vibratoVoice(0));
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    rack.noteOn(60, 110);
    for (let i = 0; i < 100; i++) rack.render(L, R, N);
    // LFO delay already full at delay=0; editing to 99 must re-hold.
    rack.setVoiceParamForPart(0, G.lfoDelay, 99);
    for (let i = 0; i < 50; i++) {
      rack.render(L, R, N);
      expect(rack.getStatus().lfo).toBeCloseTo(0.5, 5);
    }
  });
});
