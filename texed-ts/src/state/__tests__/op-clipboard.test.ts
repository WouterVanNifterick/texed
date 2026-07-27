// Copying an operator has to carry the AMEM extras that live outside the voice,
// and a swap has to survive the bit fields those extras share between operators.

import { describe, expect, it } from 'vitest';
import { initVoice } from '@texed/dx7-format/cartridge';
import { G, OP, opBase } from '@texed/dx7-format/voice';
import { getAms, getScalingMode, setAms, setScalingMode } from '@texed/dx7-format/supplement';
import {
  effectiveMode,
  hasEdits,
  planPaste,
  planSwap,
  readClip,
  resolveDrop,
  type Edits,
} from '../op-clipboard';

function apply(voice: Uint8Array, supplement: Uint8Array, edits: Edits) {
  const v = new Uint8Array(voice);
  const s = new Uint8Array(supplement);
  for (const e of edits.voice) v[e.offset] = e.value;
  for (const e of edits.supplement) s[e.offset] = e.value;
  return { voice: v, supplement: s };
}

function opBytes(voice: Uint8Array, opNum: number) {
  const base = opBase(opNum);
  return Array.from(voice.slice(base, base + 21));
}

/** A voice where every operator is distinguishable from every other. */
function markedVoice() {
  const voice = initVoice();
  for (let opNum = 1; opNum <= 6; opNum++) {
    const base = opBase(opNum);
    for (let i = 0; i < 21; i++) voice[base + i] = opNum * 3 + i;
    voice[base + OP.ampModSens] = 3; // stays in range so the AMS split is exercised
  }
  return voice;
}

/** AMS 0-7 and the fractional-scaling flag, packed the way the AMEM is. */
function markedSupplement() {
  let sup = new Uint8Array(35);
  for (let opIdx = 0; opIdx < 6; opIdx++) {
    const ams = setAms(sup, opIdx, opIdx + 1);
    sup = new Uint8Array(sup);
    sup[ams.offset] = ams.value;
    const fract = setScalingMode(sup, opIdx, opIdx % 2 === 0);
    sup[fract.offset] = fract.value;
  }
  return sup;
}

describe('pasting a whole operator', () => {
  it('reproduces the source, AMEM extras included', () => {
    const voice = markedVoice();
    const sup = markedSupplement();
    const clip = readClip(voice, sup, 3);

    const next = apply(voice, sup, planPaste(voice, sup, clip, 5, 'all'));

    expect(opBytes(next.voice, 5)).toEqual(opBytes(voice, 3));
    expect(getAms(next.supplement, 6 - 5)).toBe(getAms(sup, 6 - 3));
    expect(getScalingMode(next.supplement, 6 - 5)).toBe(getScalingMode(sup, 6 - 3));
    // Everything else is untouched, including the neighbours sharing those bytes.
    expect(opBytes(next.voice, 3)).toEqual(opBytes(voice, 3));
    expect(getAms(next.supplement, 6 - 6)).toBe(getAms(sup, 6 - 6));
  });

  it('emits nothing when the target already matches', () => {
    const voice = markedVoice();
    const sup = markedSupplement();
    const clip = readClip(voice, sup, 3);
    expect(hasEdits(planPaste(voice, sup, clip, 3, 'all'))).toBe(false);
  });

  it('leaves the operator on/off bitmask alone', () => {
    const voice = markedVoice();
    const sup = markedSupplement();
    voice[G.opEnable] = 0b101010;
    const clip = readClip(voice, sup, 3);
    const next = apply(voice, sup, planPaste(voice, sup, clip, 5, 'all'));
    expect(next.voice[G.opEnable]).toBe(0b101010);
  });
});

describe('pasting an envelope', () => {
  it('moves the eight EG bytes and nothing else', () => {
    const voice = markedVoice();
    const sup = markedSupplement();
    const clip = readClip(voice, sup, 3);

    const edits = planPaste(voice, sup, clip, 5, 'env');
    const next = apply(voice, sup, edits);

    expect(edits.voice).toHaveLength(8);
    expect(edits.supplement).toHaveLength(0);
    const from = opBase(3);
    const to = opBase(5);
    for (let i = 0; i < 4; i++) {
      expect(next.voice[to + OP.egRate(i)]).toBe(voice[from + OP.egRate(i)]);
      expect(next.voice[to + OP.egLevel(i)]).toBe(voice[from + OP.egLevel(i)]);
    }
    expect(next.voice[to + OP.outputLevel]).toBe(voice[to + OP.outputLevel]);
  });

  it('falls back to the envelope when the pitch EG is at either end', () => {
    const voice = markedVoice();
    const sup = markedSupplement();
    const opClip = readClip(voice, sup, 2);
    const pitchClip = readClip(voice, sup, 'pitch');

    expect(effectiveMode(opClip, 'pitch', 'all')).toBe('env');
    expect(effectiveMode(pitchClip, 4, 'all')).toBe('env');

    const onPitch = apply(voice, sup, planPaste(voice, sup, opClip, 'pitch', 'all'));
    for (let i = 0; i < 4; i++) {
      expect(onPitch.voice[G.pitchEgRate(i)]).toBe(opClip.rates[i]);
      expect(onPitch.voice[G.pitchEgLevel(i)]).toBe(opClip.levels[i]);
    }

    const onOp = apply(voice, sup, planPaste(voice, sup, pitchClip, 4, 'all'));
    expect(opBytes(onOp.voice, 4).slice(8)).toEqual(opBytes(voice, 4).slice(8));
  });
});

describe('swapping two operators', () => {
  it('exchanges parameters and AMEM extras both ways', () => {
    const voice = markedVoice();
    const sup = markedSupplement();
    const before = { three: opBytes(voice, 3), five: opBytes(voice, 5) };

    const next = apply(voice, sup, planSwap(voice, sup, 3, 5));

    expect(opBytes(next.voice, 3)).toEqual(before.five);
    expect(opBytes(next.voice, 5)).toEqual(before.three);
    expect(getAms(next.supplement, 6 - 3)).toBe(getAms(sup, 6 - 5));
    expect(getAms(next.supplement, 6 - 5)).toBe(getAms(sup, 6 - 3));
    expect(getScalingMode(next.supplement, 6 - 3)).toBe(getScalingMode(sup, 6 - 5));
    expect(getScalingMode(next.supplement, 6 - 5)).toBe(getScalingMode(sup, 6 - 3));
  });

  it('survives neighbours that share a supplement byte', () => {
    // OP1 and OP2 are sysex indices 5 and 4, whose AMS nibbles are in one byte -
    // and every fractional-scaling flag lives in byte 0.
    const voice = markedVoice();
    const sup = markedSupplement();

    const next = apply(voice, sup, planSwap(voice, sup, 1, 2));

    expect(getAms(next.supplement, 5)).toBe(getAms(sup, 4));
    expect(getAms(next.supplement, 4)).toBe(getAms(sup, 5));
    expect(getScalingMode(next.supplement, 5)).toBe(getScalingMode(sup, 4));
    expect(getScalingMode(next.supplement, 4)).toBe(getScalingMode(sup, 5));
    // The operators that were not part of the swap keep their flags.
    for (const opIdx of [0, 1, 2, 3]) {
      expect(getScalingMode(next.supplement, opIdx)).toBe(getScalingMode(sup, opIdx));
    }
  });
});

describe('resolving a drop', () => {
  const voice = markedVoice();
  const sup = markedSupplement();
  const clip = readClip(voice, sup, 3);

  it('reads the whole operator off the panel body and the EG off the graph', () => {
    expect(resolveDrop(clip, 5, false, false)?.kind).toBe('all');
    expect(resolveDrop(clip, 5, true, false)?.kind).toBe('env');
  });

  it('turns a whole-operator copy into a swap while Alt is held', () => {
    expect(resolveDrop(clip, 5, false, true)?.kind).toBe('swap');
    // Alt has nothing to swap when only the envelope is in play.
    expect(resolveDrop(clip, 5, true, true)?.kind).toBe('env');
    expect(resolveDrop(clip, 'pitch', false, true)?.kind).toBe('env');
  });

  it('refuses a drop onto the source, and with nothing dragged', () => {
    expect(resolveDrop(clip, 3, false, false)).toBeNull();
    expect(resolveDrop(null, 5, false, false)).toBeNull();
  });
});
