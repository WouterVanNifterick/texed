#include "compressor.h"

#include <algorithm>
#include <cmath>

#include "approx.h"

namespace texed {

namespace {

constexpr double kThreshDbfs = -20;
constexpr double kCompRatio = 5;
constexpr double kAttackSec = 0.005;
constexpr double kReleaseSec = 0.2;
/** Envelope follower runs five times faster than the gain smoothing. */
constexpr double kLevelLpSec = 0.002;
/** Floor on the smoothed power estimate, i.e. never below -130 dBFS. */
constexpr double kMinLevelPow = 1e-13;

constexpr double kHpCutoffHz = 20;
constexpr double kPi = 3.141592653589793;
constexpr double kSqrt2 = 1.4142135623730951;

}  // namespace

void Compressor::init(double sampleRate) {
    attackConst = std::exp(-1 / (kAttackSec * sampleRate));
    releaseConst = std::exp(-1 / (kReleaseSec * sampleRate));
    levelLpConst = std::exp(-1 / (kLevelLpSec * sampleRate));

    // Second-order Butterworth highpass by bilinear transform.
    const double w = std::tan((kPi * kHpCutoffHz) / sampleRate);
    const double norm = 1 / (1 + kSqrt2 * w + w * w);
    b0 = norm;
    b1 = -2 * norm;
    b2 = norm;
    a1 = -2 * (w * w - 1) * norm;
    a2 = -(1 - kSqrt2 * w + w * w) * norm;

    reset();
}

void Compressor::reset() {
    prevLevelPow = 1;
    prevGainDb = 0;
    x1 = x2 = y1 = y2 = 0;
}

void Compressor::process(float* block, int len) {
    const double c1 = levelLpConst;
    const double c2 = 1 - c1;
    const double oneMinusAttack = 1 - attackConst;
    const double oneMinusRelease = 1 - releaseConst;
    // Above the threshold, every dB of input buys 1/ratio dB of output.
    const double slope = 1 / kCompRatio - 1;

    for (int i = 0; i < len; ++i) {
        const double x = block[i];
        const double y = b0 * x + b1 * x1 + b2 * x2 + a1 * y1 + a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;

        const double pow = c1 * prevLevelPow + c2 * y * y;
        prevLevelPow = pow;

        const double levelDb = 10 * log10Approx(pow);
        const double targetDb = std::min(0.0, (levelDb - kThreshDbfs) * slope);

        prevGainDb = targetDb < prevGainDb ? attackConst * prevGainDb + oneMinusAttack * targetDb
                                           : releaseConst * prevGainDb + oneMinusRelease * targetDb;

        block[i] = (float)(y * pow10Approx(prevGainDb / 20));
    }

    // Clamped once per block, as in the reference, so the follower cannot walk
    // off toward negative infinity during silence.
    if (prevLevelPow < kMinLevelPow) prevLevelPow = kMinLevelPow;
}

}  // namespace texed
