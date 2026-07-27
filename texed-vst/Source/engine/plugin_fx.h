// Dexed's post-synthesis chain: DC blocker, ramped output gain and the OBXd
// 4-pole resonant ladder. Port of dx7-engine/src/plugin-fx.ts.
//
// The ladder self-bypasses at cutoff 1 and the ramp is a no-op at unity gain,
// so an untouched instance only runs the DC blocker.

#pragma once

namespace texed {

class PluginFx {
public:
    /** Filter cutoff 0..1; 1 bypasses the ladder entirely. */
    double cutoff = 1;
    /** Filter resonance 0..1. */
    double resonance = 0;
    /** Target output gain. Reached over ~100 ms so changes do not click. */
    double gain = 1;
    /**
     * Whether this instance removes DC. The rack runs one blocker on the master
     * bus rather than one per part; a blocker is linear, so which side of the mix
     * it sits on does not change the result beyond rounding.
     */
    bool dcBlock = true;

    void init(double sampleRate);
    void resetState();
    void process(float* work, int numSamples);

private:
    double nr24(double sample, double g, double lpc) const;

    /** Ladder stages 1-4 plus the pre-emphasis and brightness one-poles. */
    double st[6]{};
    double aGain = 1;
    double rampDt = 10.0 / 44100;

    double sampleRateInv = 1.0 / 44100;
    double bright = 0;
    double rcor24 = 0;
    double rcor24Inv = 0;
    double r24 = 0;
    double rCutoff = 0;

    // Cached against `cutoff` / `resonance` so the coefficient solve only runs
    // when something actually moved.
    double pCutoff = -1;
    double pReso = -1;

    double dcId = 0;
    double dcOd = 0;
    double dcR = 0;
};

}  // namespace texed
