// Portamento rate tables.
//
// The `dexed` tables are msfa/porta.cpp verbatim. The `hardware` tables come from
// the v1.8 ROM, where portamento reuses the pitch EG's rate table:
// PORTA_COMPUTE_RATE_VALUE takes `TABLE_PITCH_EG_RATE[99 - time]`, and
// PORTA_PROCESS steps the voice pitch by that rate times a multiplier - a fixed 3
// for glissando, or one per remaining 3 semitones of distance otherwise, which
// turns a plain glide into an exponential ease-in. msfa's constants glide 5-16x
// too fast and cannot reach the DX7's slowest setting of ~0.55 semitones/second.

import { N } from './synth';
import { pitchenvRate } from './env-tables';
import { EGS_UNIT_Q24, SLOW_TICK_HZ, isHardwareAccurate } from './engine-accuracy';

/** Rate for portamento time 0, large enough that any glide completes in one block. */
const INSTANT = 1 << 30;

/**
 * Per-block glide step, given the base rate and how far the voice still has to
 * travel (Q24). PORTA_PROCESS scales a plain glide by one multiplier per
 * remaining 3 semitones - 1024 EGS units, so `>>> 22` in Q24 - which is what
 * makes a DX7 portamento ease in rather than run at constant speed. Glissando
 * uses a fixed multiplier, already folded into `ratesGlissando`.
 */
export function portaStep(rate: number, distance: number, glissando: boolean): number {
  if (glissando || !Porta.distanceScaled) return rate;
  return rate * ((Math.abs(distance) >>> 22) + 1);
}

export const Porta = {
  rates: new Int32Array(128),
  ratesGlissando: new Int32Array(128),

  /**
   * True when the caller must scale the step by the remaining distance
   * (`(|delta| >>> 22) + 1`). Only the hardware tables want this; the msfa
   * tables are constant-rate by construction.
   */
  distanceScaled: false,

  initSr(sampleRate: number): void {
    if (isHardwareAccurate()) {
      // PORTA_PROCESS covers half the voices per output-compare interrupt, so a
      // given voice steps at half the tick rate - same cadence as the pitch EG.
      const unit = (N * EGS_UNIT_Q24 * SLOW_TICK_HZ) / sampleRate;
      for (let i = 0; i < 128; i++) {
        const time = Math.min(99, Math.trunc((i * 99) / 127));
        if (time === 0) {
          this.rates[i] = INSTANT;
          this.ratesGlissando[i] = INSTANT;
          continue;
        }
        const rate = pitchenvRate[99 - time];
        this.rates[i] = Math.trunc(0.5 + rate * unit);
        this.ratesGlissando[i] = Math.trunc(0.5 + 3 * rate * unit);
      }
      this.distanceScaled = true;
      return;
    }

    this.distanceScaled = false;
    const step = (1 << 24) / 12;
    for (let i = 0; i < 128; i++) {
      // number of semitones travelled
      let sps = 2100.0 * Math.pow(2.0, -0.062 * i); // per second
      let spf = sps / sampleRate; // per frame
      let spp = spf * N; // per period
      this.rates[i] = Math.trunc(0.5 + step * spp);

      // glissando is slower when enabled
      sps = 1300.0 * Math.pow(2.0, -0.062 * i);
      spf = sps / sampleRate;
      spp = spf * N;
      this.ratesGlissando[i] = Math.trunc(0.5 + step * spp);
    }
  },
};
