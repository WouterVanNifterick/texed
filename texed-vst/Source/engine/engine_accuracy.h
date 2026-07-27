// Which of two calibrations the rate tables and level curves use.
// Port of dx7-engine/src/engine-accuracy.ts; see that file for the reasoning.
//
// `hardware` follows the v1.8 ROM disassembly and the OPS/EGS die analysis.
// `dexed` keeps music-synthesizer-for-android's original numbers.

#pragma once

namespace texed {

enum class EngineAccuracy { Hardware, Dexed };

EngineAccuracy getEngineAccuracy();
bool isHardwareAccurate();

/**
 * Set the mode. Returns true when it actually changed, in which case the caller
 * must re-run the sample-rate table init (see `setEngineAccuracy` in tables.h).
 */
bool setEngineAccuracyMode(EngineAccuracy mode);

// ---------------------------------------------------------------------------
// Hardware timing constants, from the ROM and the DX7 service manual.

/** `SYSTEM_TICK_PERIOD` E-cycles between output-compare interrupts. */
constexpr double kSystemTickPeriod = 3140.0;

/** HD6303 E clock: the DX7's 9.4265 MHz crystal divided by 8. */
constexpr double kEClockHz = 9426300.0 / 8.0;

/**
 * Output-compare interrupt rate, ~375.26 Hz. `HANDLER_OCF` advances the LFO and
 * rewrites the pitch- and amp-mod registers once per tick.
 */
constexpr double kOcfTickHz = kEClockHz / kSystemTickPeriod;

/**
 * ~187.63 Hz. The pitch EG runs on alternate ticks, and `PORTA_PROCESS` covers
 * half the voices per tick, so both advance at half the OCF rate.
 */
constexpr double kSlowTickHz = kOcfTickHz / 2.0;

/** Units per octave in the EGS voice-frequency word. */
constexpr int kEgsUnitsPerOctave = 4096;

/** One EGS frequency unit in Q24 log-frequency. */
constexpr int kEgsUnitQ24 = (1 << 24) / kEgsUnitsPerOctave;

}  // namespace texed
