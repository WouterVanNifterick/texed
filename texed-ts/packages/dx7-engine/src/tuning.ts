// Tuning: maps a MIDI note to a Q24/octave log-frequency. StandardTuning is
// 12-TET (ported from msfa/tuning.cc); MicroTuning applies a DX7II micro-tuning
// table (1/1024-octave per-key offsets). Both share the same interpolation and
// master-tune handling.

import { MICRO_UNITS_PER_OCTAVE } from '@texed/dx7-format/microtuning';

export interface TuningState {
  midinoteToLogfreq(midinote: number): number;
  isStandardTuning(): boolean;
  setMasterTuneCents(cents: number): void;
}

const BASE = 50857777;
const OCTAVE_Q24 = 1 << 24;
const SEMITONE_Q24 = Math.trunc(OCTAVE_Q24 / 12);
const MICRO_UNIT_Q24 = Math.trunc(OCTAVE_Q24 / MICRO_UNITS_PER_OCTAVE);

/** Shared 128-entry log-frequency table with linear interpolation + master tune. */
abstract class TableTuning implements TuningState {
  protected table = new Int32Array(128);
  protected masterTuneCents = 0;

  /** Untuned Q24 log-frequency for a MIDI note (before the master-tune offset). */
  protected abstract untuned(midinote: number): number;

  protected rebuildTable(): void {
    const tuneOffset = Math.trunc((this.masterTuneCents / 100) * SEMITONE_Q24);
    for (let mn = 0; mn < 128; mn++) {
      this.table[mn] = this.untuned(mn) + tuneOffset;
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

class StandardTuning extends TableTuning {
  constructor() {
    super();
    this.rebuildTable();
  }

  protected untuned(mn: number): number {
    return BASE + SEMITONE_Q24 * mn;
  }
}

class MicroTuning extends TableTuning {
  private readonly units: Int32Array;

  constructor(units: Int32Array) {
    super();
    this.units = units;
    this.rebuildTable();
  }

  protected untuned(mn: number): number {
    return BASE + this.units[mn] * MICRO_UNIT_Q24;
  }

  isStandardTuning(): boolean {
    return false;
  }
}

export function createStandardTuning(): TuningState {
  return new StandardTuning();
}

/** Build a micro-tuning from decoded per-key units (1/1024 octave); see decodeMicrotuning. */
export function createMicroTuning(units: Int32Array): TuningState {
  return new MicroTuning(units);
}
