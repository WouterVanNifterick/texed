// Portamento rate tables, ported bit-exactly from msfa/porta.cpp + porta.h.

import { N } from './synth';

export const Porta = {
  rates: new Int32Array(128),
  ratesGlissando: new Int32Array(128),

  initSr(sampleRate: number): void {
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
