// Port of dx7-engine/src/compressor.ts. Keep the two in step; the null test
// compares their output sample for sample.

#pragma once

namespace texed {

/**
 * Feed-forward log-domain compressor, one per part. Attenuation only: the gain
 * block is clamped at 0 dB, so this never makes anything louder.
 */
class Compressor {
public:
    explicit Compressor(double sampleRate = 44100.0) { init(sampleRate); }

    void init(double sampleRate);
    void reset();

    /** Current gain reduction in dB, for metering. Never positive. */
    double gainReductionDb() const { return prevGainDb; }

    void process(float* block, int len);

private:
    double attackConst = 0;
    double releaseConst = 0;
    double levelLpConst = 0;

    double prevLevelPow = 1;
    double prevGainDb = 0;

    // Direct form 1 highpass: b0, b1, b2 and the already-negated a1, a2.
    double b0 = 1;
    double b1 = 0;
    double b2 = 0;
    double a1 = 0;
    double a2 = 0;
    double x1 = 0;
    double x2 = 0;
    double y1 = 0;
    double y2 = 0;
};

}  // namespace texed
