// Port of dx7-engine/src/plate-reverb.ts. Keep the two in step; the null test
// compares their output sample for sample.

#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace texed {

/**
 * Stereo plate reverb after MiniDexed's effect_platervbstereo. Every buffer is
 * allocated in the constructor: nothing here may allocate on the audio thread.
 */
class PlateReverb {
public:
    explicit PlateReverb(double sampleRate = 44100.0);

    /** When bypassed the tail is flushed once, so it cannot resume later. */
    bool bypass = false;

    void init(double sampleRate);
    void reset();

    /** Reverb time 0..1. Also attenuates the input, so long tails cannot clip. */
    void setSize(double n);
    /** High frequency loss in the tail, 0..1. */
    void setHiDamp(double n);
    /** Low frequency loss in the tail, 0..1. Also shortens the maximum reverb
     * time, which is the other half of why this reverb needs no limiter. */
    void setLoDamp(double n);
    /** Master output lowpass 0..1, on a cubic taper. */
    void setLowpass(double n);
    /** Allpass coefficient 0..1; lower settings make the tail more echoey. */
    void setDiffusion(double n);
    /** Wet return gain 0..1, applied by the caller when mixing the tail back in. */
    void setLevel(double n);
    double level() const { return level_; }

    void process(const float* inL, const float* inR, float* outL, float* outR, int len);

private:
    using Lines = std::array<std::vector<float>, 4>;
    using Indices = std::array<int, 4>;

    double allpass(Lines& bufs, Indices& idx, int n, double input, double k);
    /** One loop stage: allpass, delay line, hi/lo shelving damper, time scaling. */
    double loopStage(int n, double input);
    /** Read one interpolated, LFO-modulated tap out of a loop delay line. */
    double tap(int n, int offset, int lfo, double gain) const;

    Lines inAllpL;
    Lines inAllpR;
    Lines loopAllp;
    Lines loopDly;

    Indices inAllpIdxL{};
    Indices inAllpIdxR{};
    Indices loopAllpIdx{};
    Indices loopDlyIdx{};

    std::array<double, 4> lpf{};
    std::array<double, 4> hpf{};
    double loopAllpOut = 0;
    double masterLowpassL = 0;
    double masterLowpassR = 0;

    double inputAttn = 0.5;
    double inAllpK = 0.65;
    double loopAllpK = 0.65;
    double hiDampK = 1;
    double loDampK = 0;
    double lowpassF = 0.3;
    double hipassF = 0.06;
    double masterLowpassF = 0.6;
    double rvTimeK = 0.2;
    double rvTimeScaler = 1;
    double level_ = 0;

    uint32_t lfo1Phase = 0;
    uint32_t lfo1Adder = 0;
    uint32_t lfo2Phase = 0;
    uint32_t lfo2Adder = 0;
    bool flushed = false;
};

}  // namespace texed
