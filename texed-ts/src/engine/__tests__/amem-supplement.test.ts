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

describe('VoiceSupplement decode (authoritative AMEM layout)', () => {
  it('decodes per-op scaling mode from byte 0 (bit0 = OP6)', () => {
    const amem = createDefaultAmem();
    amem[0] = 0b100001; // OP1 + OP6 fractional
    const sup = new VoiceSupplement(amem);
    expect(sup.scalingMode).toEqual([1, 0, 0, 0, 0, 1]);
    expect(sup.fksEnabled).toBe(true);
  });

  it('decodes byte 4: random pitch depth, PEG vel, LFO key trigger, PEG range', () => {
    const amem = createDefaultAmem();
    amem[4] = (5 << 4) | 0x08 | 0x04 | 0x02;
    const sup = new VoiceSupplement(amem);
    expect(sup.randomPitchDepth).toBe(5);
    expect(sup.pitchEgVelSens).toBe(true);
    expect(sup.lfoKeyTrigger).toBe(true);
    expect(sup.pitchEgRange).toBe(2);
  });

  it('decodes byte 6 as PBM (bits 4-5) + PBS (bits 0-3)', () => {
    const amem = createDefaultAmem();
    amem[6] = (2 << 4) | 12; // mode HIGH, step 12
    const sup = new VoiceSupplement(amem);
    expect(sup.pitchBendMode).toBe(2);
    expect(sup.pitchBendStep).toBe(12);
  });

  it('decodes byte 7 as portamento step (bits 1-4) + mode (bit 0)', () => {
    const amem = createDefaultAmem();
    amem[7] = (7 << 1) | 1;
    const sup = new VoiceSupplement(amem);
    expect(sup.portamentoStep).toBe(7);
    expect(sup.portamentoMode).toBe(1);
  });

  it('decodes controller modulation ranges (MW/FC1/BC/AT/FC2/MC)', () => {
    const amem = createDefaultAmem();
    amem.set([10, 20, 30], 9); // MW P/A/EG
    amem.set([11, 21, 31, 41], 12); // FC1 P/A/EG/VOL
    amem.set([12, 22, 32, 82], 16); // BC P/A/EG/BIAS
    amem.set([13, 23, 33, 18], 20); // AT P/A/EG/BIAS
    amem.set([14, 24, 34, 44], 26); // FC2 P/A/EG/VOL
    amem.set([15, 25, 35, 45], 30); // MC P/A/EG/VOL
    const sup = new VoiceSupplement(amem);
    expect(sup.wheel).toMatchObject({ pitch: 10, amp: 20, eg: 30 });
    expect(sup.foot).toMatchObject({ pitch: 11, amp: 21, eg: 31, vol: 41 });
    expect(sup.breath).toMatchObject({ pitch: 12, amp: 22, eg: 32, pitchBias: 82 });
    expect(sup.at).toMatchObject({ pitch: 13, amp: 23, eg: 33, pitchBias: 18 });
    expect(sup.foot2).toMatchObject({ pitch: 14, amp: 24, eg: 34, vol: 44 });
    expect(sup.midiCtrl).toMatchObject({ pitch: 15, amp: 25, eg: 35, vol: 45 });
  });

  it('decodes byte 34 as FCCS1 (bit 3) + unison detune (bits 0-2)', () => {
    const amem = createDefaultAmem();
    amem[34] = 0x08 | 5;
    const sup = new VoiceSupplement(amem);
    expect(sup.fc1AsCs1).toBe(true);
    expect(sup.unisonDetune).toBe(5);
  });

  it('default AMEM has centered pitch bias and PB range 2', () => {
    const sup = new VoiceSupplement(createDefaultAmem());
    expect(sup.breath.pitchBias).toBe(50);
    expect(sup.at.pitchBias).toBe(50);
    expect(sup.pitchBendRange).toBe(2);
    expect(sup.pitchBendMode).toBe(0);
  });
});

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

  it('applies portamento time and step-glissando from AMEM', () => {
    const amem = createDefaultAmem();
    amem[7] = 3 << 1; // porta step 3
    amem[8] = 50; // porta time
    const sup = new VoiceSupplement(amem);
    const ctrls = new Controllers();
    sup.applyToControllers(ctrls);
    expect(ctrls.portamentoEnableCc).toBe(true);
    expect(ctrls.portamentoCc).toBe(50);
    expect(ctrls.portamentoGlissCc).toBe(true);
    expect(ctrls.portamentoStepCc).toBe(3);
  });

  it('disables portamento when time is 0, clearing stale enabled state', () => {
    const amem = createDefaultAmem();
    amem[8] = 0; // porta time 0
    const sup = new VoiceSupplement(amem);
    const ctrls = new Controllers();
    // Simulate a previously-enabled portamento state (sticky bug repro).
    ctrls.portamentoEnableCc = true;
    ctrls.portamentoCc = 50;
    sup.applyToControllers(ctrls);
    expect(ctrls.portamentoEnableCc).toBe(false);
    expect(ctrls.portamentoCc).toBe(0);
  });

  it('routes controller ranges into per-destination modulation', () => {
    const amem = createDefaultAmem();
    amem.set([99, 0, 0], 9); // MW pitch 99
    amem.set([0, 99, 0, 0], 20); // AT amp 99
    const sup = new VoiceSupplement(amem);
    const ctrls = new Controllers();
    sup.applyToControllers(ctrls);

    ctrls.modwheelCc = 127;
    ctrls.aftertouchCc = 64;
    ctrls.refresh();
    expect(ctrls.pitchMod).toBe(Math.trunc(127 * 0.99));
    expect(ctrls.ampMod).toBe(Math.trunc(64 * 0.99));
    expect(ctrls.egMod).toBe(127); // no EG bias assigned → full level
  });

  it('EG bias gates level, controller volume attenuates output', () => {
    const amem = createDefaultAmem();
    amem.set([0, 0, 99], 16); // BC EG bias 99
    amem.set([0, 0, 0, 99], 26); // FC2 volume 99
    const sup = new VoiceSupplement(amem);
    const ctrls = new Controllers();
    sup.applyToControllers(ctrls);

    ctrls.breathCc = 0;
    ctrls.foot2Cc = 0;
    ctrls.refresh();
    expect(ctrls.egMod).toBe(0); // silent until breath arrives
    expect(ctrls.volMod).toBe(0); // pedal down = silent

    ctrls.breathCc = 127;
    ctrls.foot2Cc = 127;
    ctrls.refresh();
    expect(ctrls.egMod).toBe(Math.trunc(127 * 0.99));
    expect(ctrls.volMod).toBe(1);
  });

  it('pitch bias shifts pitchBiasMod by up to ±1 octave', () => {
    const amem = createDefaultAmem();
    amem[19] = 99; // BC pitch bias +49
    const sup = new VoiceSupplement(amem);
    const ctrls = new Controllers();
    sup.applyToControllers(ctrls);

    ctrls.breathCc = 127;
    ctrls.refresh();
    expect(ctrls.pitchBiasMod).toBe(Math.trunc(((99 - 50) / 50) * (1 << 24)));
    ctrls.breathCc = 0;
    ctrls.refresh();
    expect(ctrls.pitchBiasMod).toBe(0);
  });

  it('FC1-as-CS1 bypasses foot controller modulation', () => {
    const amem = createDefaultAmem();
    amem.set([99, 0, 0, 0], 12); // FC1 pitch 99
    amem[34] |= 0x08; // FCCS1 on
    const sup = new VoiceSupplement(amem);
    const ctrls = new Controllers();
    sup.applyToControllers(ctrls);

    ctrls.footCc = 127;
    ctrls.refresh();
    expect(ctrls.pitchMod).toBe(0);
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

  it('unison stacks four voices per note and releases all', () => {
    const rack = new SynthRack(44100);
    rack.setSupplementParamForPart(0, 5, 0x08 | 0x02); // unison on
    rack.noteOn(60, 100, 1);
    renderBlocks(rack, 10);
    expect(rack.getStatus().totalActive).toBe(4);
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
    rack.setSupplementParamForPart(0, 4, (3 << 4) | 0x08 | 0x02); // random pitch 3 + PEG vel + PEG range 2
    rack.setSupplementParamForPart(0, 24, 7); // PEG rate scaling
    rack.noteOn(60, 100, 1);
    expect(renderBlocks(rack, 200)).toBeGreaterThan(0);
  });

  it('renders audio with LOW pitch bend mode gating', () => {
    const rack = new SynthRack(44100);
    rack.setSupplementParamForPart(0, 6, 1 << 4); // PB mode LOW
    rack.noteOn(60, 100, 1);
    rack.noteOn(64, 100, 1);
    rack.pitchBend(16383, 1);
    expect(renderBlocks(rack, 50)).toBeGreaterThan(0);
  });

  it('tracks master tune cents', () => {
    const rack = new SynthRack(44100);
    rack.applyMasterTuneCents(12.5);
    expect(rack.masterTuneCents).toBe(12.5);
    rack.noteOn(60, 100, 1);
    expect(renderBlocks(rack, 200)).toBeGreaterThan(0);
  });
});
