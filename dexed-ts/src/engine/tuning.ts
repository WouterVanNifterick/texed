// Tuning, ported from msfa/tuning.cc (StandardTuning only; SCL/KBM microtuning
// is out of scope for this build). Result is Q24/octave log-frequency.

export interface TuningState {
  midinoteToLogfreq(midinote: number): number;
  isStandardTuning(): boolean;
}

class StandardTuning implements TuningState {
  private table = new Int32Array(128);

  constructor() {
    const base = 50857777; // (1 << 24) * (log(440)/log(2) - 69/12)
    const step = (1 << 24) / 12; // integer division in C: 1398101
    const stepInt = Math.trunc(step);
    for (let mn = 0; mn < 128; mn++) {
      this.table[mn] = base + stepInt * mn;
    }
  }

  midinoteToLogfreq(midinote: number): number {
    const mn = midinote < 0 ? 0 : midinote > 127 ? 127 : midinote;
    return this.table[mn];
  }

  isStandardTuning(): boolean {
    return true;
  }
}

export function createStandardTuning(): TuningState {
  return new StandardTuning();
}
