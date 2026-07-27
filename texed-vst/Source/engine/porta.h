// Portamento rate tables. Port of dx7-engine/src/porta.ts.
//
// The `dexed` tables are msfa/porta.cpp verbatim. The `hardware` tables come
// from the v1.8 ROM, where portamento reuses the pitch EG's rate table and
// PORTA_PROCESS scales a plain glide by the remaining distance.

#pragma once

#include <cstdint>

namespace texed {

struct Porta {
    static int32_t rates[128];
    static int32_t ratesGlissando[128];

    /**
     * True when the caller must scale the step by the remaining distance. Only
     * the hardware tables want this; the msfa tables are constant-rate.
     */
    static bool distanceScaled;

    static void initSr(double sampleRate);
};

/** Per-block glide step, given the base rate and the remaining distance (Q24). */
int32_t portaStep(int32_t rate, int32_t distance, bool glissando);

}  // namespace texed
