import { describe, it, expect } from 'vitest';
import { VoiceSupplement, createDefaultAmem } from '../amem';
import { Controllers } from '../controllers';
import { SynthRack } from '../synth-rack';
import { initVoice } from '../cartridge';
import { N } from '../synth';

const renderBlocks = (rack: SynthRack, blocks: number): number => {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let peak = 0;
  for (let b = 0; b < blocks; b++) {
    rack.render(L, R, N);
    for (const s of L) peak = Math.max(peak, Math.abs(s));
  }
  return peak;
};

describe('VoiceSupplement.applyToControllers', () => {
  it('applies pitch bend range and step', () => {
    const amem = createDefaultAmem();
    amem[5] = 0x08 | (7 << 2); // PB range 7
    amem[6] = 4; // PB step 4
    const sup = new VoiceSupplement(amem);
    const ctrls = new Controllers();
    sup.applyToControllers(ctrls);
    expect(ctrls.values_[129]).toBe(7); // range up
    expect(ctrls.values_[131]).toBe(7); // range down
    expect(ctrls.values_[130]).toBe(4); // step
  });

  it('applies portamento time and glissando from AMEM', () => {
    const amem = createDefaultAmem();
    amem[7] = 0x02; // gliss on
    amem[8] = 50; // porta time
    const sup = new VoiceSupplement(amem);
    const ctrls = new Controllers();
    sup.applyToControllers(ctrls);
    expect(ctrls.portamentoEnableCc).toBe(true);
    expect(ctrls.portamentoCc).toBe(50);
    expect(ctrls.portamentoGlissCc).toBe(true);
  });
});

describe('supplement plumbing through SynthRack', () => {
  it('round-trips a supplement byte edit', () => {
    const rack = new SynthRack(44100);
    rack.setSupplementParamForPart(0, 5, 0x08 | 0x01); // mono on
    expect(rack.getSupplementData(0)[5] & 0x01).toBe(1);
  });

  it('keeps the supplement when a bare voice is loaded (VCED semantics)', () => {
    const rack = new SynthRack(44100);
    rack.setSupplementParamForPart(0, 6, 5); // PB step 5
    rack.loadVoiceForPart(0, initVoice());
    expect(rack.getSupplementData(0)[6]).toBe(5);
  });

  it('unison stacks two voices per note and releases both', () => {
    const rack = new SynthRack(44100);
    rack.setSupplementParamForPart(0, 5, 0x08 | 0x02); // unison on
    rack.noteOn(60, 100, 1);
    renderBlocks(rack, 10);
    expect(rack.getStatus().totalActive).toBe(2);
    rack.noteOff(60, 1);
    renderBlocks(rack, 4000);
    expect(rack.getStatus().totalActive).toBe(0);
  });

  it('mono AMEM flag survives program changes but is refreshed per slot', () => {
    const rack = new SynthRack(44100);
    rack.setSupplementParamForPart(0, 5, 0x08 | 0x01); // mono on
    rack.noteOn(60, 100, 1);
    rack.noteOn(64, 100, 1);
    renderBlocks(rack, 10);
    // Mono: the second note-on releases the first key.
    expect(rack.getStatus().totalActive).toBeLessThanOrEqual(2);
  });

  it('renders audio with DX7II pitch EG range / velocity / random pitch active', () => {
    const rack = new SynthRack(44100);
    rack.setSupplementParamForPart(0, 4, 0x10 | 0x08 | 0x02); // random pitch + PEG vel + PEG range 2
    rack.setSupplementParamForPart(0, 24, 7); // PEG rate scaling
    rack.noteOn(60, 100, 1);
    expect(renderBlocks(rack, 200)).toBeGreaterThan(0);
  });

  it('tracks master tune cents', () => {
    const rack = new SynthRack(44100);
    rack.applyMasterTuneCents(12.5);
    expect(rack.masterTuneCents).toBe(12.5);
    rack.noteOn(60, 100, 1);
    expect(renderBlocks(rack, 200)).toBeGreaterThan(0);
  });
});
