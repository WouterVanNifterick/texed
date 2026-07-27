import { describe, it, expect } from 'vitest';
import { initVoice } from '@texed/dx7-format/cartridge';
import { G } from '@texed/dx7-format/voice';
import { SynthUnit } from '../synth-unit';
import { N } from '../synth';

describe('live parameter edit', () => {
  it('does not restart the pitch EG when an unrelated param changes', () => {
    const v = initVoice();
    // Slow pitch EG so stage 0 is still running when we edit.
    for (let i = 0; i < 4; i++) v[G.pitchEgRate(i)] = 20;
    v[G.pitchEgLevel(0)] = 99;
    v[G.pitchEgLevel(1)] = 50;
    v[G.pitchEgLevel(2)] = 50;
    v[G.pitchEgLevel(3)] = 50;

    const synth = new SynthUnit(44100);
    synth.loadVoice(v);
    synth.noteOn(60, 100);

    const block = new Float32Array(N);
    for (let i = 0; i < 30; i++) synth.render(block, block.length);

    const before = synth.getStatus().pitchStep;
    expect(before).toBe(0); // still in pitch EG attack

    synth.setVoiceParam(G.lfoDelay, 70);
    for (let i = 0; i < 2; i++) synth.render(block, block.length);

    // set() would have jumped back through level[3] and restarted at stage 0
    // with a fresh attack; update() must leave the running stage alone.
    expect(synth.getStatus().pitchStep).toBe(before);
  });
});
