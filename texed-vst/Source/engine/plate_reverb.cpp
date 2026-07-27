#include "plate_reverb.h"

#include <cmath>

namespace texed {

namespace {

constexpr int kInAllpLenL[4] = {224, 420, 856, 1089};
constexpr int kInAllpLenR[4] = {156, 520, 956, 1289};
constexpr int kLoopAllpLen[4] = {2303, 2905, 3175, 2398};
constexpr int kLoopDlyLen[4] = {3423, 4589, 4365, 3698};

constexpr int kTapOffsetL[4] = {201, 145, 1897, 280};
constexpr int kTapOffsetR[4] = {1897, 1245, 487, 780};
constexpr double kTapGain[4] = {0.8, 0.7, 0.6, 0.5};

constexpr double kDefaultAllpCoeff = 0.65;
/** Scaled centre frequency of the treble loss filter in the loop. */
constexpr double kHiLossFreq = 0.3;
/** Scaled centre frequency of the bass loss filter in the loop. */
constexpr double kLoLossFreq = 0.06;
constexpr double kMasterLowpassF = 0.6;
constexpr double kLfo1FreqHz = 1.37;
constexpr double kLfo2FreqHz = 1.52;
constexpr double kRvTimeKMax = 0.95;

/** Modulation depth is the top 5 bits of the 16-bit LFO, so +/-16 samples. */
constexpr int kLfoFracBits = 11;
constexpr int kLfoFracMask = (1 << kLfoFracBits) - 1;

constexpr double kPi = 3.141592653589793;

/** 256-point signed 16-bit sine with a wrap entry, as in the reference table. */
const std::array<int16_t, 257>& sineTable() {
    static const auto table = [] {
        std::array<int16_t, 257> t{};
        for (int i = 0; i < 257; ++i) {
            t[(size_t)i] = (int16_t)std::lround(32767 * std::sin((2 * kPi * i) / 256));
        }
        return t;
    }();
    return table;
}

double mapfloat(double v, double inMin, double inMax, double outMin, double outMax) {
    return ((v - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

double clamp01(double n) {
    return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Math.floor(a / b) for positive b, which C++ integer division does not give. */
int floorDiv(int64_t a, int64_t b) {
    const int64_t q = a / b;
    return (int)(a % b != 0 && a < 0 ? q - 1 : q);
}

/** Interpolated sine from the phase accumulator, as a signed 16-bit value. */
int lfoSin(uint32_t phase) {
    const auto& sine = sineTable();
    const int idx = (int)((phase >> 24) & 0xff);
    const int64_t frac = phase & 0x00ffffff;
    const int64_t y = (int64_t)sine[(size_t)idx] * (0x00ffffff - frac) +
                      (int64_t)sine[(size_t)idx + 1] * frac;
    return floorDiv(y, 0x1000000);
}

/**
 * Quarter-turn companion to `lfoSin`. The reference reuses the table index as
 * the interpolation fraction here, which leaves the cosine effectively
 * un-interpolated; kept as-is so the tail matches MiniDexed.
 */
int lfoCos(uint32_t phase) {
    const auto& sine = sineTable();
    const int idx = (int)(((phase >> 24) + 64) & 0xff);
    const int64_t y =
        (int64_t)sine[(size_t)idx] * (0x00ffffff - idx) + (int64_t)sine[(size_t)idx + 1] * idx;
    return floorDiv(y, 0x1000000);
}

void allocate(std::array<std::vector<float>, 4>& lines, const int (&lengths)[4]) {
    for (int i = 0; i < 4; ++i) lines[(size_t)i].assign((size_t)lengths[i], 0.0f);
}

}  // namespace

PlateReverb::PlateReverb(double sampleRate) {
    allocate(inAllpL, kInAllpLenL);
    allocate(inAllpR, kInAllpLenR);
    allocate(loopAllp, kLoopAllpLen);
    allocate(loopDly, kLoopDlyLen);
    inAllpK = kDefaultAllpCoeff;
    loopAllpK = kDefaultAllpCoeff;
    lowpassF = kHiLossFreq;
    hipassF = kLoLossFreq;
    masterLowpassF = kMasterLowpassF;
    init(sampleRate);
}

void PlateReverb::init(double sampleRate) {
    // The reference computes this as (UINT32_MAX + 1) / (sr * hz), i.e. a 2^32
    // phase accumulator, written out here because that expression overflows to
    // zero in C and silently disables the modulation.
    lfo1Adder = (uint32_t)std::llround(4294967296.0 / (sampleRate * kLfo1FreqHz));
    lfo2Adder = (uint32_t)std::llround(4294967296.0 / (sampleRate * kLfo2FreqHz));
    reset();
}

void PlateReverb::reset() {
    for (auto* lines : {&inAllpL, &inAllpR, &loopAllp, &loopDly}) {
        for (auto& buf : *lines) std::fill(buf.begin(), buf.end(), 0.0f);
    }
    inAllpIdxL = {};
    inAllpIdxR = {};
    loopAllpIdx = {};
    loopDlyIdx = {};
    lpf = {};
    hpf = {};
    loopAllpOut = 0;
    masterLowpassL = 0;
    masterLowpassR = 0;
    lfo1Phase = 0;
    lfo2Phase = 0;
}

void PlateReverb::setSize(double n) {
    const double t = mapfloat(clamp01(n), 0, 1, 0.2, kRvTimeKMax);
    rvTimeK = t;
    inputAttn = mapfloat(t, 0, kRvTimeKMax, 0.5, 0.25);
}

void PlateReverb::setHiDamp(double n) {
    hiDampK = 1 - clamp01(n);
}

void PlateReverb::setLoDamp(double n) {
    const double v = clamp01(n);
    loDampK = -v;
    rvTimeScaler = 1 - v * 0.12;
}

void PlateReverb::setLowpass(double n) {
    const double v = clamp01(n);
    masterLowpassF = mapfloat(v * v * v, 0, 1, 0.05, 1);
}

void PlateReverb::setDiffusion(double n) {
    const double k = mapfloat(clamp01(n), 0, 1, 0.005, 0.65);
    inAllpK = k;
    loopAllpK = k;
}

void PlateReverb::setLevel(double n) {
    level_ = clamp01(n);
}

double PlateReverb::allpass(Lines& bufs, Indices& idx, int n, double input, double k) {
    auto& buf = bufs[(size_t)n];
    const int i = idx[(size_t)n];
    const double acc = buf[(size_t)i] + input * k;
    buf[(size_t)i] = (float)(input - k * acc);
    idx[(size_t)n] = i + 1 >= (int)buf.size() ? 0 : i + 1;
    return acc;
}

double PlateReverb::loopStage(int n, double input) {
    double x = allpass(loopAllp, loopAllpIdx, n, input, loopAllpK);

    auto& dly = loopDly[(size_t)n];
    const int di = loopDlyIdx[(size_t)n];
    const double delayed = dly[(size_t)di];
    dly[(size_t)di] = (float)x;
    loopDlyIdx[(size_t)n] = di + 1 >= (int)dly.size() ? 0 : di + 1;
    x = delayed;

    lpf[(size_t)n] += (x - lpf[(size_t)n]) * lowpassF;
    const double above = x - lpf[(size_t)n];
    hpf[(size_t)n] += (lpf[(size_t)n] - hpf[(size_t)n]) * hipassF;
    const double shelved = lpf[(size_t)n] + above * hiDampK + hpf[(size_t)n] * loDampK;

    return shelved * rvTimeK * rvTimeScaler;
}

double PlateReverb::tap(int n, int offset, int lfo, double gain) const {
    const auto& buf = loopDly[(size_t)n];
    const int len = (int)buf.size();
    int i = (loopDlyIdx[(size_t)n] + offset + (lfo >> kLfoFracBits)) % len;
    const double a = buf[(size_t)i];
    if (++i >= len) i = 0;
    const double b = buf[(size_t)i];
    const double frac = (double)(lfo & kLfoFracMask) / kLfoFracMask;
    return (a * (1 - frac) + b * frac) * gain;
}

void PlateReverb::process(const float* inL, const float* inR, float* outL, float* outR, int len) {
    if (bypass) {
        if (!flushed) {
            reset();
            flushed = true;
        }
        std::fill(outL, outL + len, 0.0f);
        std::fill(outR, outR + len, 0.0f);
        return;
    }
    flushed = false;

    for (int i = 0; i < len; ++i) {
        lfo1Phase += lfo1Adder;
        lfo2Phase += lfo2Adder;
        const int lfo1S = lfoSin(lfo1Phase);
        const int lfo1C = lfoCos(lfo1Phase);
        const int lfo2S = lfoSin(lfo2Phase);
        const int lfo2C = lfoCos(lfo2Phase);

        double x = inL[i] * inputAttn;
        for (int n = 0; n < 4; ++n) x = allpass(inAllpL, inAllpIdxL, n, x, inAllpK);
        const double inOutL = x;

        x = inR[i] * inputAttn;
        for (int n = 0; n < 4; ++n) x = allpass(inAllpR, inAllpIdxR, n, x, inAllpK);
        const double inOutR = x;

        // Figure-eight: the two input chains are injected alternately so the
        // channels cross-feed each other.
        double acc = loopStage(0, loopAllpOut + inOutR);
        acc = loopStage(1, acc + inOutL);
        acc = loopStage(2, acc + inOutR);
        loopAllpOut = loopStage(3, acc + inOutL);

        // Tap 1 is deliberately unmodulated; taps 2-4 ride the LFOs.
        double wetL = tap(0, kTapOffsetL[0], 0, kTapGain[0]);
        wetL += tap(1, kTapOffsetL[1], lfo1S, kTapGain[1]);
        wetL += tap(2, kTapOffsetL[2], lfo2C, kTapGain[2]);
        wetL += tap(3, kTapOffsetL[3], lfo2S, kTapGain[3]);
        masterLowpassL += (wetL - masterLowpassL) * masterLowpassF;
        outL[i] = (float)masterLowpassL;

        double wetR = tap(0, kTapOffsetR[0], 0, kTapGain[0]);
        wetR += tap(1, kTapOffsetR[1], lfo1C, kTapGain[1]);
        wetR += tap(2, kTapOffsetR[2], lfo2S, kTapGain[2]);
        // The reference drives this tap's read position from lfo1 but its
        // interpolation fraction from lfo2, which is an inconsistency rather
        // than a design choice; both come from lfo1 here.
        wetR += tap(3, kTapOffsetR[3], lfo1S, kTapGain[3]);
        masterLowpassR += (wetR - masterLowpassR) * masterLowpassF;
        outR[i] = (float)masterLowpassR;
    }
}

}  // namespace texed
