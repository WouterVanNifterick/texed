// DX7 pitch envelope. Port of dx7-engine/src/pitchenv.ts.
// Result is Q24/octave, subsampled once per block.

#pragma once

#include <cstdint>

namespace texed {

/** Q24 pitch increment per block for one unit of pitch EG rate. */
int32_t pitchEnvUnit(double sampleRate);

class PitchEnv {
public:
    static void init(double sampleRate);

    void set(const int32_t r[4], const int32_t l[4]);
    int32_t getsample();
    void keydown(bool d);
    int getPosition() const { return ix; }
    /** Current Q24-per-octave level. */
    int32_t getLevel() const { return level; }

private:
    void advance(int newix);

    int32_t rates[4]{};
    int32_t levels[4]{};
    int32_t level = 0;
    int32_t targetlevel = 0;
    bool rising = false;
    int ix = 0;
    int32_t inc = 0;
    bool down = true;
};

}  // namespace texed
