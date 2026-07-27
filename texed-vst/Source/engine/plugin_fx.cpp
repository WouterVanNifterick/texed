#include "plugin_fx.h"

#include <algorithm>
#include <cmath>

#include "approx.h"

namespace texed {

namespace {

constexpr int S1 = 0;
constexpr int S2 = 1;
constexpr int S3 = 2;
constexpr int S4 = 3;
constexpr int C = 4;
constexpr int D = 5;

constexpr double kPi = 3.14159265358979323846;

/** One-pole topology-preserving transform, as in the C++ original. */
inline double tptpc(double* st, int i, double inp, double cutoff) {
    const double v = ((inp - st[i]) * cutoff) / (1 + cutoff);
    const double res = v + st[i];
    st[i] = res + v;
    return res;
}

/** Same, with the cutoff given in Hz rather than prewarped. */
inline double tptlpupw(double* st, int i, double inp, double hz, double srInv) {
    const double cutoff = hz * srInv * kPi;
    const double v = ((inp - st[i]) * cutoff) / (1 + cutoff);
    const double res = v + st[i];
    st[i] = res + v;
    return res;
}

/** Exponential taper with the OBXd rolloff of 19. */
inline double logsc(double param, double min, double max, double rolloff = 19) {
    return ((std::exp(param * std::log(rolloff + 1)) - 1) / rolloff) * (max - min) + min;
}

}  // namespace

void PluginFx::init(double sampleRate) {
    sampleRateInv = 1.0 / sampleRate;
    rampDt = 10.0 / sampleRate;  // full-scale gain change in 100 ms

    const double rcrate = std::sqrt(44000.0 / sampleRate);
    rcor24 = (970.0 / 44000.0) * rcrate;
    rcor24Inv = 1 / rcor24;
    bright = std::tan((sampleRate * 0.5 - 10) * kPi * sampleRateInv);

    r24 = 0;
    pCutoff = -1;
    pReso = -1;
    dcR = 1.0 - 126.0 / sampleRate;
    resetState();
}

void PluginFx::resetState() {
    dcId = 0;
    dcOd = 0;
    std::fill(st, st + 6, 0.0);
}

double PluginFx::nr24(double sample, double g, double lpc) const {
    const double ml = 1 / (1 + g);
    const double s = (lpc * (lpc * (lpc * st[S1] + st[S2]) + st[S3]) + st[S4]) * ml;
    const double gg = lpc * lpc * lpc * lpc;
    return (sample - r24 * s) / (1 + r24 * gg) + 1e-8;
}

void PluginFx::process(float* work, int numSamples) {
    if (numSamples <= 0) return;

    if (dcBlock) {
        double tFd = work[0];
        work[0] = (float)(work[0] - dcId + dcR * dcOd);
        dcId = tFd;
        for (int i = 1; i < numSamples; i++) {
            tFd = work[i];
            work[i] = (float)(work[i] - dcId + dcR * work[i - 1]);
            dcId = tFd;
        }
        dcOd = work[numSamples - 1];
    }

    if (gain != aGain) {
        for (int i = 0; i < numSamples; i++) {
            if (aGain != gain) {
                aGain = gain > aGain ? std::min(gain, aGain + rampDt) : std::max(gain, aGain - rampDt);
            }
            work[i] = (float)(work[i] * aGain);
        }
    } else if (aGain == 0) {
        std::fill(work, work + numSamples, 0.0f);
    } else if (aGain != 1) {
        for (int i = 0; i < numSamples; i++) work[i] = (float)(work[i] * aGain);
    }

    if (cutoff >= 1) return;

    if (cutoff != pCutoff || resonance != pReso) {
        const double rReso = 0.991 - logsc(1 - resonance, 0, 0.991);
        r24 = 3.5 * rReso;
        rCutoff = std::tan(logsc(cutoff, 60, 19000) * sampleRateInv * kPi);
        pCutoff = cutoff;
        pReso = resonance;
    }

    const double g = rCutoff;
    const double lpc = g / (1 + g);
    const double makeup = 1 + r24 * 0.45;

    for (int i = 0; i < numSamples; i++) {
        double s = work[i];
        s = s - 0.45 * tptlpupw(st, C, s, 15, sampleRateInv);
        s = tptpc(st, D, s, bright);

        const double y0 = nr24(s, g, lpc);

        const double v = (y0 - st[S1]) * lpc;
        const double res = v + st[S1];
        st[S1] = res + v;
        // Nonlinear damping in the first stage: this is what gives the ladder its
        // character, and why it needs an arctangent every sample.
        st[S1] = atanApprox(st[S1] * rcor24) * rcor24Inv;

        const double y2 = tptpc(st, S2, res, g);
        const double y3 = tptpc(st, S3, y2, g);
        const double y4 = tptpc(st, S4, y3, g);

        work[i] = (float)(y4 * makeup);
    }
}

}  // namespace texed
