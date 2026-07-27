#include "env.h"

#include <algorithm>

#include "../msfa/synth.h"
#include "env_tables.h"

namespace texed {

namespace {

int32_t srMultiplier = 1 << 24;
double sampleRate = 44100.0;

// TX802 EG Forced Damp: a stolen voice fades to silence over this window before
// its slot is reclaimed, avoiding the click of an instantaneous cut.
constexpr double kDampMs = 6.0;

}  // namespace

void Env::initSr(double sr) {
    sampleRate = sr;
    srMultiplier = (int32_t)((44100.0 / sr) * (1 << 24));
}

void Env::init(const int32_t r[4], const int32_t l[4], int ol, int rs, bool continueEnv) {
    initialised = true;
    for (int i = 0; i < 4; i++) {
        rates[i] = r[i];
        levels[i] = l[i];
    }
    outlevel = ol;
    rateScaling = rs;
    // Forced Damp OFF (continueEnv): keep the current level so the new note's
    // attack continues from where the stolen note left off. ON: restart from zero.
    if (!continueEnv) level = 0;
    down = true;
    damping = false;
    advance(0);
}

int32_t Env::getsample() {
    if (staticcount) {
        staticcount -= N;
        if (staticcount <= 0) {
            staticcount = 0;
            advance(ix + 1);
        }
    }

    if (ix < 3 || (ix < 4 && !down)) {
        if (staticcount) {
            // holding: no level change this block
        } else if (rising) {
            const int32_t jumptarget = 1716;
            if (level < (jumptarget << 16)) level = jumptarget << 16;
            // Wraps on overflow, as msfa's int32 arithmetic and the TypeScript
            // engine's Math.imul both do; unsigned keeps that defined.
            const uint32_t step = (uint32_t)(((17 << 24) - level) >> 24) * (uint32_t)inc;
            level = (int32_t)((uint32_t)level + step);
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

void Env::keydown(bool d) {
    if (down != d) {
        down = d;
        advance(d ? 0 : 3);
    }
}

void Env::forceDamp() {
    down = false;
    rising = false;
    damping = true;
    staticcount = 0;
    targetlevel = 0;
    ix = 3;
    const int32_t blocks = std::max(1, (int32_t)((kDampMs / 1000.0) * sampleRate) / N);
    inc = std::max(1, level / blocks);
}

void Env::advance(int newix) {
    ix = newix;
    if (ix < 4) {
        const int newlevel = levels[ix];
        int actuallevel = ampLevelBase(newlevel) + outlevel - 4256;
        actuallevel = actuallevel < 16 ? 16 : actuallevel;
        targetlevel = actuallevel << 16;
        rising = targetlevel > level;

        const int shortHold = (ix == 0 && newlevel == 0) ? 1 : 0;
        if (targetlevel == level || shortHold) {
            const int staticrate = std::min(99, (int)rates[ix] + rateScaling);
            staticcount = ampStaticAt(staticrate, srMultiplier, shortHold);
        } else {
            staticcount = 0;
        }

        inc = ampIncAt(rates[ix], srMultiplier, rateScaling);
    }
}

void Env::update(const int32_t r[4], const int32_t l[4], int ol, int rs) {
    for (int i = 0; i < 4; i++) {
        rates[i] = r[i];
        levels[i] = l[i];
    }
    outlevel = ol;
    rateScaling = rs;
    if (down) {
        const int newlevel = levels[2];
        // Deliberately without `+ outlevel`, matching msfa's env.cc.
        int actuallevel = ampLevelBase(newlevel) - 4256;
        actuallevel = actuallevel < 16 ? 16 : actuallevel;
        targetlevel = actuallevel << 16;
        advance(2);
    }
}

void Env::transfer(const Env& src) {
    for (int i = 0; i < 4; i++) {
        rates[i] = src.rates[i];
        levels[i] = src.levels[i];
    }
    outlevel = src.outlevel;
    rateScaling = src.rateScaling;
    level = src.level;
    targetlevel = src.targetlevel;
    rising = src.rising;
    ix = src.ix;
    down = src.down;
    staticcount = src.staticcount;
    inc = src.inc;
    damping = src.damping;
}

bool Env::isActive() const {
    if (damping && ix >= 4) return false;
    return initialised && (ix < 4 || levels[3] > 0);
}

}  // namespace texed
