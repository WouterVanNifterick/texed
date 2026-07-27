// DX7 low frequency oscillator. Port of dx7-engine/src/lfo.ts.
// Phase and increments are uint32.

#pragma once

#include <cstdint>

namespace texed {

/**
 * PATCH_ACTIVATE_SCALE_LFO_SPEED: the 16-bit phase increment the ROM writes for
 * LFO speed 0-99. The multiplier steps once every four units above 160, which is
 * the visible 10.1 -> 11.3 Hz knee at speed 63/64; speed 0 is a special case
 * that would otherwise be silent.
 */
uint32_t romLfoIncrement(int speed);

class Lfo {
public:
    static void init(double sampleRate);

    /** `params` points at the voice's LFO block (G.lfoSpeed onward). */
    void reset(const uint8_t* params);
    int32_t getsample();
    int32_t getdelay();
    void keydown();
    /** Restart only the delay ramp (e.g. after a live DELAY edit). */
    void restartDelay();

private:
    uint32_t phase = 0;  // Q32
    uint32_t delta = 0;
    int waveform = 0;
    uint32_t randstate = 0;
    bool sync = false;
    uint32_t delaystate = 0;
    uint32_t delayinc = 0;
    uint32_t delayinc2 = 0;
};

}  // namespace texed
