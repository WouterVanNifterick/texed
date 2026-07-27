// MIDI controller state. Port of dx7-engine/src/controllers.ts: msfa's
// controllers.h extended to the DX7II per-destination modulation model, where
// each physical controller has independent 0-99 ranges for pitch mod, amp mod,
// EG bias, plus volume (FC1/FC2/MIDI-ctrl) and pitch bias (BC/AT).

#pragma once

#include <cstdint>

#include "amem.h"

class FmCore;

namespace texed {

constexpr int kControllerPitch = 128;
constexpr int kControllerPitchRangeUp = 129;
constexpr int kControllerPitchStep = 130;
constexpr int kControllerPitchRangeDn = 131;

/** DX7II modulation routing for one physical controller. */
struct FmMod {
    int pitchRange = 0;
    int ampRange = 0;
    int egRange = 0;
    /** Volume range 0-99 (controller attenuates part output; FC1/FC2/MC). */
    int volRange = 0;
    /** Pitch bias 0-99, 50 = center/off (BC/AT): directly shifts pitch. */
    int pitchBiasRange = 50;
};

class Controllers {
public:
    int32_t values_[132]{};

    /** Six operator on/off flags, index 0 = OP1. */
    bool opSwitch[6] = {true, true, true, true, true, true};

    int ampMod = 0;
    int pitchMod = 0;
    int egMod = 0;
    /** Q24 log-frequency offset from BC/AT pitch bias (+/-1 octave full scale). */
    int32_t pitchBiasMod = 0;
    /** 0..1 gain factor from FC1/FC2/MIDI-ctrl volume ranges. */
    float volMod = 1.0f;

    int aftertouchCc = 0;
    int breathCc = 0;
    int footCc = 0;
    /** Foot controller 2 (CC 11). Defaults high: an unplugged pedal reads max. */
    int foot2Cc = 127;
    /** "MIDI IN controller" (CC 13 by default on this implementation). */
    int midiCsCc = 127;
    int modwheelCc = 0;
    bool portamentoEnableCc = false;
    int portamentoCc = 0;
    bool portamentoGlissCc = false;
    /** Portamento step 0-12: 0 = smooth, n = glissando in n-semitone steps. */
    int portamentoStepCc = 0;
    /** When set, FC1 acts as CS1 (panel slider) and its mod routings are bypassed. */
    bool fc1AsCs1 = false;

    int32_t masterTune = 0;

    bool mpeEnabled = false;
    int mpePitchBendRange = 24;

    FmMod wheel, foot, breath, at, foot2, midiCs;

    FmCore* core = nullptr;

    void refresh();

private:
    void applyMod(int cc, const FmMod& mod);
};

/** Apply per-voice controller settings from an AMEM supplement. */
void applySupplementToControllers(const VoiceSupplement& supp, Controllers& ctrls);

}  // namespace texed
