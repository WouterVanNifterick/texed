#include "porta.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "../msfa/synth.h"
#include "engine_accuracy.h"
#include "env_tables.h"

namespace texed {

namespace {
/** Rate for portamento time 0, large enough that any glide completes in a block. */
constexpr int32_t kInstant = 1 << 30;
}

int32_t Porta::rates[128] = {};
int32_t Porta::ratesGlissando[128] = {};
bool Porta::distanceScaled = false;

int32_t portaStep(int32_t rate, int32_t distance, bool glissando) {
    if (glissando || !Porta::distanceScaled) return rate;
    // One multiplier per remaining 3 semitones (1024 EGS units, so >> 22 in Q24)
    // is what makes a DX7 portamento ease in rather than run at constant speed.
    return rate * (int32_t)(((uint32_t)std::abs(distance) >> 22) + 1);
}

void Porta::initSr(double sampleRate) {
    if (isHardwareAccurate()) {
        // PORTA_PROCESS covers half the voices per output-compare interrupt, so a
        // given voice steps at half the tick rate: the pitch EG's cadence.
        const double unit = (N * (double)kEgsUnitQ24 * kSlowTickHz) / sampleRate;
        for (int i = 0; i < 128; i++) {
            const int time = std::min(99, (i * 99) / 127);
            if (time == 0) {
                rates[i] = kInstant;
                ratesGlissando[i] = kInstant;
                continue;
            }
            const int rate = kPitchenvRate[99 - time];
            rates[i] = (int32_t)(0.5 + rate * unit);
            ratesGlissando[i] = (int32_t)(0.5 + 3 * rate * unit);
        }
        distanceScaled = true;
        return;
    }

    distanceScaled = false;
    const double step = (double)(1 << 24) / 12.0;
    for (int i = 0; i < 128; i++) {
        // number of semitones travelled
        double sps = 2100.0 * std::pow(2.0, -0.062 * i);  // per second
        rates[i] = (int32_t)(0.5 + step * (sps / sampleRate) * N);

        // glissando is slower when enabled
        sps = 1300.0 * std::pow(2.0, -0.062 * i);
        ratesGlissando[i] = (int32_t)(0.5 + step * (sps / sampleRate) * N);
    }
}

}  // namespace texed
