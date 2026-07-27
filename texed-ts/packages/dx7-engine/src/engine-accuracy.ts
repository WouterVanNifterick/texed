// Which of two calibrations the rate tables and level curves use.
//
// `hardware` follows the v1.8 ROM disassembly and the OPS/EGS die analysis.
// `dexed` keeps music-synthesizer-for-android's original numbers, which is what
// this engine shipped with and what every other Dexed-derived synth sounds like.
//
// Only the handful of places where the two genuinely disagree consult this:
// keyboard level scaling curves, the velocity chain, and the LFO / pitch EG /
// portamento rates. Everything else the ROM settled is fixed unconditionally -
// those were plain bugs with no legacy worth preserving.

export type EngineAccuracy = 'hardware' | 'dexed';

let current: EngineAccuracy = 'hardware';

export function getEngineAccuracy(): EngineAccuracy {
  return current;
}

export function isHardwareAccurate(): boolean {
  return current === 'hardware';
}

/**
 * Set the mode. Returns true when it actually changed, in which case the caller
 * must re-run the sample-rate table init (see `setEngineAccuracy` in synth-unit).
 */
export function setEngineAccuracyMode(mode: EngineAccuracy): boolean {
  if (current === mode) return false;
  current = mode;
  return true;
}

// ---------------------------------------------------------------------------
// Hardware timing constants, from the ROM and the DX7 service manual.

/** `SYSTEM_TICK_PERIOD` E-cycles between output-compare interrupts. */
const SYSTEM_TICK_PERIOD = 3140;

/** HD6303 E clock: the DX7's 9.4265 MHz crystal divided by 8. */
const E_CLOCK_HZ = 9426300 / 8;

/**
 * Output-compare interrupt rate, ~375.26 Hz. `HANDLER_OCF` advances the LFO and
 * rewrites the pitch- and amp-mod registers once per tick.
 */
export const OCF_TICK_HZ = E_CLOCK_HZ / SYSTEM_TICK_PERIOD;

/**
 * ~187.63 Hz. The pitch EG runs on alternate ticks (`M_PITCH_EG_UPDATE_TOGGLE`),
 * and `PORTA_PROCESS` covers half the voices per tick, so both advance at half
 * the OCF rate.
 */
export const SLOW_TICK_HZ = OCF_TICK_HZ / 2;

/** Units per octave in the EGS voice-frequency word. */
export const EGS_UNITS_PER_OCTAVE = 4096;

/** One EGS frequency unit in Q24 log-frequency. */
export const EGS_UNIT_Q24 = (1 << 24) / EGS_UNITS_PER_OCTAVE;
