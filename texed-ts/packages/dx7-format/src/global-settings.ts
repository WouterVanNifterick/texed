// Global "system setup" — the realtime settings that apply across the whole
// rack rather than to a single part. Treated as part of the live edit buffer
// (owned by SynthRack, snapshotted in RackState), not a library concept.

/** Global plate reverb, fed by the per-part `reverbSend`. All 0..1. */
export interface ReverbSettings {
  enabled: boolean;
  /** Reverb time; also attenuates the input as it rises. */
  size: number;
  /** High frequency loss in the tail. */
  hiDamp: number;
  /** Low frequency loss in the tail. */
  loDamp: number;
  /** Master output lowpass, for darkening the tail. */
  lowpass: number;
  /** Allpass coefficient; lower is more echoey. */
  diffusion: number;
  /** Wet return level. */
  level: number;
}

/** MiniDexed's shipped values, converted from its 0..99 controls. */
export const DEFAULT_REVERB_SETTINGS: ReverbSettings = {
  enabled: false,
  size: 70 / 99,
  hiDamp: 50 / 99,
  loDamp: 50 / 99,
  lowpass: 30 / 99,
  diffusion: 65 / 99,
  level: 1,
};

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
  /**
   * Which calibration the level curves and LFO / pitch EG / portamento rates use.
   * 'hardware' follows the DX7 ROM; 'dexed' keeps the msfa numbers this engine
   * shipped with, for A/B against other Dexed-derived synths.
   */
  accuracy: 'hardware' | 'dexed';
  /** Per-part compressor, switched globally as MiniDexed does. */
  compressor: boolean;
  reverb: ReverbSettings;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  engine: 1, // MARK I
  volume: 80,
  polyphony: 32,
  masterTuneCents: 0,
  microtuning: -1,
  accuracy: 'hardware',
  compressor: false,
  reverb: { ...DEFAULT_REVERB_SETTINGS },
};

/** Perceptual volume taper: knob 0..99 → linear master gain 0..1. */
export function volumeToGain(volume: number): number {
  return (Math.max(0, Math.min(99, volume)) / 99) ** 2;
}
