import { describe, it, expect } from 'vitest';
import { PlateReverb } from '../plate-reverb';

const SR = 44100;

/** A single full-scale impulse, then silence, so the tail is all that is left. */
function impulseTail(reverb: PlateReverb, blocks: number, blockSize = 512) {
  const inL = new Float32Array(blockSize);
  const inR = new Float32Array(blockSize);
  const outL = new Float32Array(blockSize);
  const outR = new Float32Array(blockSize);
  const energy: number[] = [];

  inL[0] = 1;
  inR[0] = 1;
  for (let b = 0; b < blocks; b++) {
    reverb.process(inL, inR, outL, outR, blockSize);
    let sum = 0;
    for (let i = 0; i < blockSize; i++) sum += outL[i] * outL[i] + outR[i] * outR[i];
    energy.push(sum);
    inL[0] = 0;
    inR[0] = 0;
  }
  return { energy, outL, outR };
}

function makeReverb(size = 0.7) {
  const r = new PlateReverb(SR);
  r.setSize(size);
  r.setHiDamp(0.5);
  r.setLoDamp(0.5);
  r.setLowpass(0.3);
  r.setDiffusion(0.65);
  r.setLevel(1);
  return r;
}

describe('PlateReverb', () => {
  it('builds a tail from an impulse and decays to silence', () => {
    const { energy } = impulseTail(makeReverb(), 200);
    const peak = Math.max(...energy);
    expect(peak).toBeGreaterThan(0);
    // Still ringing well after the impulse, but gone by the end.
    expect(energy[20]).toBeGreaterThan(peak * 1e-4);
    expect(energy[energy.length - 1]).toBeLessThan(peak * 1e-6);
  });

  it('decays more slowly at a larger size', () => {
    const late = (size: number) => impulseTail(makeReverb(size), 120).energy.slice(60);
    const short = late(0.1).reduce((a, b) => a + b, 0);
    const long = late(1).reduce((a, b) => a + b, 0);
    expect(long).toBeGreaterThan(short * 10);
  });

  it('stays bounded with continuous full-scale input', () => {
    const r = makeReverb(1);
    r.setLoDamp(0);
    const inL = new Float32Array(512).fill(1);
    const inR = new Float32Array(512).fill(-1);
    const outL = new Float32Array(512);
    const outR = new Float32Array(512);
    let peak = 0;
    for (let b = 0; b < 400; b++) {
      r.process(inL, inR, outL, outR, 512);
      for (let i = 0; i < 512; i++) {
        peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
      }
    }
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeLessThan(4);
  });

  it('decorrelates the two channels', () => {
    const { outL, outR } = impulseTail(makeReverb(), 40);
    let same = 0;
    for (let i = 0; i < outL.length; i++) same += Math.abs(outL[i] - outR[i]);
    expect(same).toBeGreaterThan(0);
  });

  it('outputs silence when bypassed and does not resume the old tail', () => {
    const r = makeReverb();
    impulseTail(r, 10);

    r.bypass = true;
    const { energy: off } = impulseTail(r, 4);
    expect(off.every((e) => e === 0)).toBe(true);

    r.bypass = false;
    const silence = new Float32Array(512);
    const outL = new Float32Array(512);
    const outR = new Float32Array(512);
    r.process(silence, silence, outL, outR, 512);
    expect(outL.every((v) => v === 0)).toBe(true);
  });
});
