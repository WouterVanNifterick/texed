// Tuning, ported from msfa/tuning.cc (StandardTuning only; SCL/KBM microtuning
// is out of scope for this build). Result is Q24/octave log-frequency.

export interface TuningState {
  midinoteToLogfreq(midinote: number): number;
  isStandardTuning(): boolean;
  setMasterTuneCents(cents: number): void;
}

class StandardTuning implements TuningState {
  private table = new Int32Array(128);
  private masterTuneCents = 0;

  constructor() {
    this.rebuildTable();
  }

  private rebuildTable(): void {
    const base = 50857777;
    const step = Math.trunc((1 << 24) / 12);
    const tuneOffset = Math.trunc((this.masterTuneCents / 100) * step);
    for (let mn = 0; mn < 128; mn++) {
      this.table[mn] = base + step * mn + tuneOffset;
    }
  }

  setMasterTuneCents(cents: number): void {
    this.masterTuneCents = cents;
    this.rebuildTable();
  }

  midinoteToLogfreq(midinote: number): number {
    const clamped = Math.max(0, Math.min(127, midinote));
    const lo = Math.floor(clamped);
    const hi = Math.min(127, lo + 1);
    const frac = clamped - lo;
    if (frac === 0) return this.table[lo];
    return Math.trunc(this.table[lo] * (1 - frac) + this.table[hi] * frac);
  }

  isStandardTuning(): boolean {
    return this.masterTuneCents === 0;
  }
}

export function createStandardTuning(): TuningState {
  return new StandardTuning();
}
