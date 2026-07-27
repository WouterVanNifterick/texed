// DX7 amplitude envelope. Port of dx7-engine/src/env.ts (itself msfa/env.cc with
// ACCURATE_ENVELOPE on). Result is Q24/doubling log, subsampled once per block.

#pragma once

#include <cstdint>

namespace texed {

class Env {
public:
    static void initSr(double sr);

    void init(const int32_t r[4], const int32_t l[4], int ol, int rateScaling,
              bool continueEnv = false);
    int32_t getsample();
    void keydown(bool d);

    /**
     * TX802 forced damp: ramp quickly to silence instead of the note's own
     * release, so a stolen voice can be reclaimed without a click.
     */
    void forceDamp();

    void update(const int32_t r[4], const int32_t l[4], int ol, int rateScaling);
    int getPosition() const { return ix; }
    void transfer(const Env& src);
    bool isActive() const;

private:
    void advance(int newix);

    bool initialised = false;
    int32_t rates[4]{};
    int32_t levels[4]{};
    int outlevel = 0;
    int rateScaling = 0;
    // 2^24 is one doubling.
    int32_t level = 0;
    int32_t targetlevel = 0;
    bool rising = false;
    int ix = 0;
    int32_t inc = 0;
    int32_t staticcount = 0;
    bool down = true;
    bool damping = false;
};

}  // namespace texed
