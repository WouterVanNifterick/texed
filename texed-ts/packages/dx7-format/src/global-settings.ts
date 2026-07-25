// Global "system setup" — the realtime settings that apply across the whole
// rack rather than to a single part. Treated as part of the live edit buffer
// (owned by SynthRack, snapshotted in RackState), not a library concept.

export interface GlobalSettings {
  /** FM engine model index (0 MODERN, 1 MARK I, 2 OPL). */
  engine: number;
  /** Master output volume knob 0..99; a perceptual taper maps it to gain. */
  volume: number;
  /** Maximum simultaneous voices before note stealing. */
  polyphony: number;
  /** Master tune offset in cents (−50..+50), global pitch offset. */
  masterTuneCents: number;
  /** Active micro-tuning index into the loaded tables, or -1 for standard tuning. */
  microtuning: number;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  engine: 1, // MARK I
  volume: 80,
  polyphony: 32,
  masterTuneCents: 0,
  microtuning: -1,
};

/** Perceptual volume taper: knob 0..99 → linear master gain 0..1. */
export function volumeToGain(volume: number): number {
  return (Math.max(0, Math.min(99, volume)) / 99) ** 2;
}
