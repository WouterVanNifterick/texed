// Shared DSP table setup. Port of the table-init half of
// dx7-engine/src/synth-unit.ts.

#pragma once

#include "engine_accuracy.h"

namespace texed {

/** Initialize the shared, sample-rate-dependent DSP tables. */
void initSynthTables(double sampleRate);

/**
 * Switch between the hardware-derived and msfa calibrations. The LFO, pitch EG
 * and portamento tables are built at init time, so changing the mode rebuilds
 * them at the current sample rate.
 */
void setEngineAccuracy(EngineAccuracy mode);

}  // namespace texed
