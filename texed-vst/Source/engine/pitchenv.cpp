#include "pitchenv.h"

#include <cmath>

#include "../msfa/synth.h"
#include "engine_accuracy.h"
#include "env_tables.h"

namespace texed {

namespace {
int32_t unit = 0;
}

int32_t pitchEnvUnit(double sampleRate) {
    // PITCH_EG_PROCESS adds the rate byte straight to the 4096-per-octave voice
    // pitch on every other output-compare interrupt. msfa's 21.3 assumes a
    // ~192.3 Hz tick against the hardware's ~187.63 Hz, i.e. 2.5% fast.
    return isHardwareAccurate()
               ? (int32_t)std::floor((N * (double)kEgsUnitQ24 * kSlowTickHz) / sampleRate + 0.5)
               : (int32_t)std::floor((N * (double)(1 << 24)) / (21.3 * sampleRate) + 0.5);
}

void PitchEnv::init(double sampleRate) {
    unit = pitchEnvUnit(sampleRate);
}

void PitchEnv::set(const int32_t r[4], const int32_t l[4]) {
    for (int i = 0; i < 4; i++) {
        rates[i] = r[i];
        levels[i] = l[i];
    }
    level = pitchLevelAt(l[3]);
    down = true;
    advance(0);
}

void PitchEnv::update(const int32_t r[4], const int32_t l[4]) {
    for (int i = 0; i < 4; i++) {
        rates[i] = r[i];
        levels[i] = l[i];
    }
    if (ix < 4) {
        targetlevel = pitchLevelAt(levels[ix]);
        rising = targetlevel > level;
        inc = pitchIncAt(rates[ix], unit);
    }
}

int32_t PitchEnv::getsample() {
    if (ix < 3 || (ix < 4 && !down)) {
        if (rising) {
            level += inc;
            if (level >= targetlevel) {
                level = targetlevel;
                advance(ix + 1);
            }
        } else {
            level -= inc;
            if (level <= targetlevel) {
                level = targetlevel;
                advance(ix + 1);
            }
        }
    }
    return level;
}

void PitchEnv::keydown(bool d) {
    if (down != d) {
        down = d;
        advance(d ? 0 : 3);
    }
}

void PitchEnv::advance(int newix) {
    ix = newix;
    if (ix < 4) {
        targetlevel = pitchLevelAt(levels[ix]);
        rising = targetlevel > level;
        inc = pitchIncAt(rates[ix], unit);
    }
}

}  // namespace texed
