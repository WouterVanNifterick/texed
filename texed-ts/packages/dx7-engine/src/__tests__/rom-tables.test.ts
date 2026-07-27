// Identity checks against the Yamaha DX7 v1.8 ROM disassembly (ajxs).
//
// Every table below is transcribed straight from the firmware. The engine is a
// port of music-synthesizer-for-android, which reconstructed several of these by
// inference and got some of them wrong - the keyboard scaling exponential curve
// was 24 dB out at the top, and the velocity curve about twice too deep at the
// bottom. These tests pin the tables to the ROM so the next transcription slip
// shows up here rather than as an unexplained golden-hash diff.

import { describe, it, expect } from 'vitest';
import {
  kbdScaleCurve,
  kbdScalingCurveExp,
  kbdScalingCurveLin,
  pitchenvRate,
  pitchenvTab,
  romScaleValue,
  scaleoutlevel,
  velocityAttenuation,
} from '../env-tables';
import { Lfo, romLfoIncrement } from '../lfo';
import { OCF_TICK_HZ } from '../engine-accuracy';
import { logfreqRoundSemi, scaleVelocity } from '../dx7note';
import { setEngineAccuracy } from '../synth-unit';
import { Porta, portaStep } from '../porta';
import { N } from '../synth';

/** One logical output level unit in dB: 2^24 of them is a doubling. */
const DB_PER_UNIT = 6.020599913279624 / 256;

// prettier-ignore
/** TABLE_LOG, 100 bytes. Attenuation for a 0-99 level parameter. */
const TABLE_LOG = [
  0x7f, 0x7a, 0x76, 0x72, 0x6e, 0x6b, 0x68, 0x66, 0x64, 0x62,
  0x60, 0x5e, 0x5c, 0x5a, 0x58, 0x56, 0x55, 0x54, 0x52, 0x51,
  0x4f, 0x4e, 0x4d, 0x4c, 0x4b, 0x4a, 0x49, 0x48, 0x47, 0x46,
  0x45, 0x44, 0x43, 0x42, 0x41, 0x40, 0x3f, 0x3e, 0x3d, 0x3c,
  0x3b, 0x3a, 0x39, 0x38, 0x37, 0x36, 0x35, 0x34, 0x33, 0x32,
  0x31, 0x30, 0x2f, 0x2e, 0x2d, 0x2c, 0x2b, 0x2a, 0x29, 0x28,
  0x27, 0x26, 0x25, 0x24, 0x23, 0x22, 0x21, 0x20, 0x1f, 0x1e,
  0x1d, 0x1c, 0x1b, 0x1a, 0x19, 0x18, 0x17, 0x16, 0x15, 0x14,
  0x13, 0x12, 0x11, 0x10, 0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a,
  0x09, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x00,
];

// prettier-ignore
/** TABLE_KBD_SCALING_CURVE_EXP, 36 bytes. */
const TABLE_KBD_SCALING_CURVE_EXP = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
  0x0b, 0x0e, 0x10, 0x13, 0x17, 0x1c, 0x21, 0x27, 0x2f, 0x39,
  0x43, 0x50, 0x5f, 0x71, 0x86, 0xa0, 0xbe, 0xe0, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];

// prettier-ignore
/** TABLE_KBD_SCALING_CURVE_LIN, 36 bytes. Index 22 is $B2, not the $B0 the pattern implies. */
const TABLE_KBD_SCALING_CURVE_LIN = [
  0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0x40, 0x48,
  0x50, 0x58, 0x60, 0x68, 0x70, 0x78, 0x80, 0x88, 0x90, 0x98,
  0xa0, 0xa8, 0xb2, 0xb8, 0xc0, 0xc8, 0xd0, 0xd8, 0xe0, 0xe8,
  0xf0, 0xf8, 0xff, 0xff, 0xff, 0xff,
];

// prettier-ignore
/** TABLE_PITCH_EG_RATE, 100 bytes. Also drives portamento. */
const TABLE_PITCH_EG_RATE = [
  0x01, 0x02, 0x03, 0x03, 0x04, 0x04, 0x05, 0x05, 0x06, 0x06,
  0x07, 0x07, 0x08, 0x08, 0x09, 0x09, 0x0a, 0x0a, 0x0b, 0x0b,
  0x0c, 0x0c, 0x0d, 0x0d, 0x0e, 0x0e, 0x0f, 0x10, 0x10, 0x11,
  0x12, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a,
  0x1b, 0x1c, 0x1e, 0x1f, 0x21, 0x22, 0x24, 0x25, 0x26, 0x27,
  0x29, 0x2a, 0x2c, 0x2e, 0x2f, 0x31, 0x33, 0x35, 0x36, 0x38,
  0x3a, 0x3c, 0x3e, 0x40, 0x42, 0x44, 0x46, 0x48, 0x4a, 0x4c,
  0x4f, 0x52, 0x55, 0x58, 0x5b, 0x5e, 0x62, 0x66, 0x6a, 0x6e,
  0x73, 0x78, 0x7d, 0x82, 0x87, 0x8d, 0x93, 0x99, 0x9f, 0xa5,
  0xab, 0xb2, 0xb9, 0xc1, 0xca, 0xd3, 0xe8, 0xf3, 0xfe, 0xff,
];

// prettier-ignore
/** TABLE_PITCH_EG_LEVEL, 100 bytes. $80 (index 50) is neutral pitch. */
const TABLE_PITCH_EG_LEVEL = [
  0x00, 0x0c, 0x18, 0x21, 0x2b, 0x34, 0x3c, 0x43, 0x48, 0x4c,
  0x4f, 0x52, 0x55, 0x57, 0x59, 0x5b, 0x5d, 0x5f, 0x60, 0x61,
  0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b,
  0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f,
  0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f, 0x90, 0x91, 0x92, 0x93,
  0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d,
  0x9e, 0x9f, 0xa0, 0xa1, 0xa2, 0xa3, 0xa6, 0xa8, 0xab, 0xae,
  0xb1, 0xb5, 0xba, 0xc1, 0xc9, 0xd2, 0xdc, 0xe7, 0xf3, 0xff,
];

describe('ROM table identities', () => {
  it('scaleoutlevel is the complement of TABLE_LOG', () => {
    for (let ol = 0; ol < 100; ol++) {
      expect(scaleoutlevel(ol)).toBe(127 - TABLE_LOG[ol]);
    }
  });

  it('keyboard scaling curves match the ROM byte for byte', () => {
    expect([...kbdScalingCurveExp]).toEqual(TABLE_KBD_SCALING_CURVE_EXP);
    expect([...kbdScalingCurveLin]).toEqual(TABLE_KBD_SCALING_CURVE_LIN);
  });

  it('pitch EG tables match the ROM byte for byte', () => {
    expect([...pitchenvRate]).toEqual(TABLE_PITCH_EG_RATE);
    expect([...pitchenvTab]).toEqual(TABLE_PITCH_EG_LEVEL.map((v) => v - 128));
  });

  it('romScaleValue is PATCH_ACTIVATE_SCALE_VALUE', () => {
    // The ROM multiplies by 660 and keeps the high byte of the 16-bit result.
    for (let v = 0; v <= 99; v++) {
      expect(romScaleValue(v)).toBe((660 * v) >>> 8);
    }
    expect(romScaleValue(99)).toBe(255);
  });

  it('romLfoIncrement reproduces the speed 63/64 knee', () => {
    expect(romLfoIncrement(0)).toBe(11); // the INCA special case, not silence
    expect(romLfoIncrement(62)).toBe(1749);
    expect(romLfoIncrement(63)).toBe(1782);
    expect(romLfoIncrement(64)).toBe(1980); // multiplier steps from 11 to 12
    expect(romLfoIncrement(99)).toBe(8670);
    for (let s = 1; s < 100; s++) {
      expect(romLfoIncrement(s)).toBeGreaterThan(romLfoIncrement(s - 1));
    }
  });

  it('velocityAttenuation matches the ROM landmarks', () => {
    // hi = ~((kvs << 1) | 0xF0): the floor at full velocity, 15 down to 1.
    const atFullVelocity = [0, 1, 2, 3, 4, 5, 6, 7].map((kvs) => velocityAttenuation(127, kvs));
    expect(atFullVelocity).toEqual([15, 13, 11, 9, 7, 5, 3, 1]);
    // Softest playable velocity, maximum sensitivity.
    expect(velocityAttenuation(0, 7)).toBe(113);
    // Sensitivity 0 ignores velocity entirely.
    for (let v = 0; v <= 127; v += 8) expect(velocityAttenuation(v, 0)).toBe(15);
  });
});

describe('keyboard level scaling', () => {
  it('stays exponential to the top of the curve', () => {
    // msfa's table went linear above group 22 and reached only 95 here.
    expect(kbdScaleCurve(28, 50, 2)).toBe(127);
    // Doubling every four groups, i.e. per octave above the breakpoint.
    expect(kbdScalingCurveExp[24] / kbdScalingCurveExp[20]).toBeCloseTo(2, 1);
  });

  it('negative curves attenuate and positive ones boost', () => {
    expect(kbdScaleCurve(12, 99, 0)).toBeLessThan(0);
    expect(kbdScaleCurve(12, 99, 1)).toBeLessThan(0);
    expect(kbdScaleCurve(12, 99, 2)).toBeGreaterThan(0);
    expect(kbdScaleCurve(12, 99, 3)).toBeGreaterThan(0);
  });

  it('depth 0 is a no-op and the curve saturates at 127', () => {
    for (let g = 0; g < 43; g++) expect(kbdScaleCurve(g, 0, 2)).toBe(0);
    expect(kbdScaleCurve(42, 99, 2)).toBe(127);
  });
});

describe('velocity scaling', () => {
  it('agrees with the msfa curve at full velocity for every sensitivity', () => {
    const hardware: number[] = [];
    const dexed: number[] = [];
    setEngineAccuracy('hardware');
    for (let kvs = 0; kvs <= 7; kvs++) hardware.push(scaleVelocity(127, kvs));
    setEngineAccuracy('dexed');
    for (let kvs = 0; kvs <= 7; kvs++) dexed.push(scaleVelocity(127, kvs));
    setEngineAccuracy('hardware');
    expect(hardware).toEqual(dexed);
  });

  it('spans the hardware 42 dB at maximum sensitivity, not msfa 84 dB', () => {
    setEngineAccuracy('hardware');
    const hw = (scaleVelocity(127, 7) - scaleVelocity(0, 7)) * DB_PER_UNIT;
    setEngineAccuracy('dexed');
    const msfa = (scaleVelocity(127, 7) - scaleVelocity(0, 7)) * DB_PER_UNIT;
    setEngineAccuracy('hardware');
    expect(hw).toBeCloseTo(42.1, 1);
    expect(msfa).toBeCloseTo(83.9, 1);
  });

  it('is monotonic in velocity', () => {
    setEngineAccuracy('hardware');
    for (let kvs = 1; kvs <= 7; kvs++) {
      for (let v = 1; v <= 127; v++) {
        expect(scaleVelocity(v, kvs)).toBeGreaterThanOrEqual(scaleVelocity(v - 1, kvs));
      }
    }
  });
});

describe('glissando quantisation', () => {
  const BASE = 50857777; // MIDI note 0 in Q24 log-frequency
  const SEMI = Math.trunc((1 << 24) / 12);
  const stepFor = (semis: number) => Math.trunc(((1 << 24) / 12) * semis);

  it('rounds down on both sides of the base note', () => {
    // JS `%` keeps the dividend's sign, so below MIDI 0 the old code rounded the
    // wrong way. Reachable with a 0.5x coarse ratio on a low note.
    const step = stepFor(1);
    for (const semitones of [-30.4, -12.7, -0.5, 0, 0.5, 7.3, 40.9]) {
      const freq = Math.round(BASE + semitones * SEMI);
      const rounded = logfreqRoundSemi(freq, 1);
      expect(rounded).toBeLessThanOrEqual(freq);
      expect(freq - rounded).toBeLessThan(step);
      expect(Math.abs((rounded - BASE) % step)).toBe(0);
    }
  });

  it('honours a multi-semitone step', () => {
    const step = stepFor(3);
    const freq = BASE + Math.round(7.9 * SEMI);
    expect(logfreqRoundSemi(freq, 3)).toBe(BASE + 2 * step);
  });
});

describe('LFO rate', () => {
  /** Measured LFO frequency in Hz, from how long a saw-up wave takes to wrap. */
  function measureHz(rate: number): number {
    const lfo = new Lfo();
    lfo.reset([rate, 99, 0, 0, 0, 2]); // saw up, no delay
    // The LFO only advances once per block, so a fast rate is barely a dozen
    // blocks per cycle - average over many to get under the quantisation.
    const CYCLES = 200;
    let prev = lfo.getsample();
    let blocks = -1; // set at the first wrap, so the partial first cycle is dropped
    let wraps = 0;
    for (let i = 0; i < 20_000_000 && wraps <= CYCLES; i++) {
      const v = lfo.getsample();
      if (v < prev) {
        wraps++;
        if (wraps === 1) blocks = 0;
      }
      prev = v;
      if (blocks >= 0) blocks++;
    }
    return CYCLES / ((blocks * N) / 44100);
  }

  it('follows the ROM increment against the ~375 Hz interrupt', () => {
    setEngineAccuracy('hardware');
    Lfo.init(44100);
    for (const rate of [0, 20, 50, 63, 64, 99]) {
      // f = increment * OCF_TICK_HZ / 2^16.
      const expected = (romLfoIncrement(rate) * OCF_TICK_HZ) / 65536;
      expect(measureHz(rate) / expected).toBeCloseTo(1, 2);
    }
    setEngineAccuracy('hardware');
  });

  it('is about 2.5% slower than the msfa calibration', () => {
    setEngineAccuracy('hardware');
    Lfo.init(44100);
    const hw = measureHz(50);
    setEngineAccuracy('dexed');
    Lfo.init(44100);
    const msfa = measureHz(50);
    setEngineAccuracy('hardware');
    Lfo.init(44100);
    expect(msfa / hw).toBeCloseTo(1.025, 2);
  });
});

describe('portamento', () => {
  /** Seconds for a one-octave glide at the given rate-table index. */
  function glideSeconds(index: number, glissando: boolean): number {
    const dst = 1 << 24; // one octave in Q24
    const rate = glissando ? Porta.ratesGlissando[index] : Porta.rates[index];
    let cur = 0;
    let blocks = 0;
    while (cur < dst && blocks < 4_000_000) {
      cur = Math.min(dst, cur + portaStep(rate, dst - cur, glissando));
      blocks++;
    }
    return (blocks * N) / 44100;
  }

  it('reaches the hardware slowest glide, which msfa could not', () => {
    setEngineAccuracy('hardware');
    Porta.initSr(44100);
    const hw = glideSeconds(127, false);
    setEngineAccuracy('dexed');
    Porta.initSr(44100);
    const msfa = glideSeconds(127, false);
    setEngineAccuracy('hardware');
    Porta.initSr(44100);

    // A DX7 at portamento time 99 crawls; msfa's slowest is over a second.
    expect(hw).toBeGreaterThan(8);
    expect(hw).toBeLessThan(15);
    expect(msfa).toBeLessThan(2);
  });

  it('eases in: the first step is larger than the last', () => {
    setEngineAccuracy('hardware');
    Porta.initSr(44100);
    const rate = Porta.rates[127];
    expect(portaStep(rate, 1 << 24, false)).toBeGreaterThan(portaStep(rate, 1 << 20, false));
    // Glissando is constant-rate, and faster than a plain glide over short spans.
    expect(portaStep(Porta.ratesGlissando[127], 1 << 24, true)).toBe(Porta.ratesGlissando[127]);
    expect(Porta.ratesGlissando[127]).toBeGreaterThan(portaStep(rate, 1 << 20, false));
  });

  it('portamento time 0 completes immediately', () => {
    setEngineAccuracy('hardware');
    Porta.initSr(44100);
    expect(glideSeconds(0, false)).toBeCloseTo(N / 44100, 5);
  });
});
