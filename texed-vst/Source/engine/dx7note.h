// DX7 voice. Port of dx7-engine/src/dx7note.ts.

#pragma once

#include <cstdint>
#include <memory>

// synth.h first: the msfa headers below expect its integer typedefs.
#include "../msfa/synth.h"

#include "../msfa/fm_op_kernel.h"
#include "amem.h"
#include "controllers.h"
#include "env.h"
#include "pitchenv.h"
#include "tuning.h"

namespace texed {

/** Quantize a Q24 log-frequency to `semis`-semitone steps (DX7II portamento step). */
int32_t logfreqRoundSemi(int32_t freq, int semis);

/** Velocity contribution to an operator's logical output level. */
int scaleVelocity(int velocity, int sensitivity);

// `midinote` is fractional here: the part adds transpose and per-part detune
// before the note reaches the voice, and the scaling curves quantise it
// themselves.
int scaleRate(double midinote, int sensitivity);

int scaleLevel(double midinote, int breakPt, int leftDepth, int rightDepth, int leftCurve,
               int rightCurve);

/** Logical output level for one operator, clamped the way the EGS register is. */
int operatorOutLevel(const uint8_t* patch, int off, double midinote, int velocity);

struct VoiceStatus {
    int32_t amp[6]{};
    int ampStep[6]{};
    /** Raw Q24 amp-envelope level per op. */
    int32_t level[6]{};
    int pitchStep = 0;
    /** Raw Q24-per-octave pitch-envelope level. */
    int32_t pitchLevel = 0;
};

class Dx7Note {
public:
    explicit Dx7Note(std::shared_ptr<TuningState> ts);

    void setTuningState(std::shared_ptr<TuningState> ts) { tuningState = std::move(ts); }
    void setSupplement(const VoiceSupplement* sup) { supplement = sup; }

    void init(const uint8_t* patch, double midinote, int velocity, int channel,
              bool continueEnv = false);
    /** Seed the glide from where the previous note is (portamento RETAIN). */
    void initPortamento(const Dx7Note& src) { portaCur = src.portaCur; }

    void compute(int32_t* buf, int32_t lfoVal, int32_t lfoDelay, const Controllers& ctrls);
    void keyup();
    /** TX802 forced damp: ramp all operators quickly to silence. */
    void forceDamp();
    void update(const uint8_t* patch, double midinote, int velocity, int channel);

    void peekVoiceStatus(VoiceStatus& status) const;
    void transferState(const Dx7Note& src);
    void transferSignal(const Dx7Note& src);
    void transferPhase(const Dx7Note& src);
    void oscSync();
    bool isPlaying() const;

    /** Pitch-bend gate for DX7II bend modes (LOW/HIGH/K.ON); set by the Part. */
    bool bendGate = true;

private:
    int amsForOp(int op, const uint8_t* patch) const;
    int32_t oscFreq(double midinote, int mode, int coarse, int fine, int detune) const;

    std::shared_ptr<TuningState> tuningState;
    const VoiceSupplement* supplement = nullptr;

    FmOpParams params[6]{};
    Env env[6];
    PitchEnv pitchenv;

    int32_t basepitch[6]{};
    // Portamento is a property of the voice, not of each operator: the EGS holds
    // one gliding voice frequency and the OPS adds the per-operator ratio on top.
    int32_t notePitch = 0;
    int32_t portaCur = 0;
    int opMode[6]{};
    int32_t ampmodsens[6]{};
    int32_t fbBuf[2]{};

    int algorithm = 0;
    int fbShift = 0;
    int pitchmoddepth = 0;
    int pitchmodsens = 0;
    int ampmoddepth = 0;

    // DX7II supplement state, latched at note-on.
    int pegShift = 0;
    double pegVelScale = 1.0;
    int32_t randPitchOffset = 0;

    bool initialised = false;
    int mpePitchBend = 8192;
};

}  // namespace texed
