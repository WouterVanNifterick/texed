#include "controllers.h"

#include <algorithm>
#include <cmath>

namespace texed {

namespace {

/** Volume factor for one controller: range 0 -> 1.0, full range + cc 0 -> 0. */
float volFactor(int cc, const FmMod& mod) {
    if (!mod.volRange) return 1.0f;
    return 1.0f - (mod.volRange / 99.0f) * (1.0f - cc / 127.0f);
}

/** Signed pitch bias contribution -1..1 (0-99 range, 50 = center). */
float biasFactor(int cc, const FmMod& mod) {
    if (mod.pitchBiasRange == 50) return 0.0f;
    return ((mod.pitchBiasRange - 50) / 50.0f) * (cc / 127.0f);
}

}  // namespace

void Controllers::applyMod(int cc, const FmMod& mod) {
    // MOD_PITCH_SUM_MOD_SOURCE and MOD_AMP_SUM_MOD_SOURCE add every assigned
    // source and saturate at the register's full scale; msfa took the maximum,
    // so a mod wheel and a breath controller both routed to pitch behaved as one.
    const auto amount = [cc](int range) { return (int)std::trunc(cc * 0.01 * range); };
    if (mod.pitchRange) pitchMod = std::min(127, pitchMod + amount(mod.pitchRange));
    if (mod.ampRange) ampMod = std::min(127, ampMod + amount(mod.ampRange));
    if (mod.egRange) egMod = std::min(127, egMod + amount(mod.egRange));
}

void Controllers::refresh() {
    ampMod = 0;
    pitchMod = 0;
    egMod = 0;

    applyMod(modwheelCc, wheel);
    applyMod(breathCc, breath);
    if (!fc1AsCs1) applyMod(footCc, foot);
    applyMod(aftertouchCc, at);
    // FC2 / MIDI-ctrl default to CC=127 for volume (unplugged pedal = open),
    // but must not feed pitch/amp/EG until a real CC arrives - otherwise
    // factory AMEM pitch routings bypass LFO delay with constant vibrato.
    applyMod(foot2Seen ? foot2Cc : 0, foot2);
    applyMod(midiCsSeen ? midiCsCc : 0, midiCs);

    // No EG bias assigned anywhere: operators play at full level.
    const bool egAssigned = wheel.egRange || breath.egRange || (!fc1AsCs1 && foot.egRange) ||
                            at.egRange || foot2.egRange || midiCs.egRange;
    if (!egAssigned) egMod = 127;

    // BC/AT pitch bias: full range shifts pitch by +/-1 octave (Q24 per octave).
    const float bias = biasFactor(breathCc, breath) + biasFactor(aftertouchCc, at);
    pitchBiasMod = (int32_t)std::trunc(std::max(-1.0f, std::min(1.0f, bias)) * (1 << 24));

    float vol = volFactor(foot2Cc, foot2) * volFactor(midiCsCc, midiCs);
    if (!fc1AsCs1) vol *= volFactor(footCc, foot);
    volMod = std::max(0.0f, std::min(1.0f, vol));
}

void applySupplementToControllers(const VoiceSupplement& supp, Controllers& ctrls) {
    const auto setMod = [](FmMod& dst, const CtrlRanges& src) {
        dst.pitchRange = src.pitch;
        dst.ampRange = src.amp;
        dst.egRange = src.eg;
        dst.volRange = src.vol;
        dst.pitchBiasRange = src.pitchBias;
    };
    setMod(ctrls.wheel, supp.wheel);
    setMod(ctrls.foot, supp.foot);
    setMod(ctrls.breath, supp.breath);
    setMod(ctrls.at, supp.at);
    setMod(ctrls.foot2, supp.foot2);
    setMod(ctrls.midiCs, supp.midiCtrl);
    ctrls.fc1AsCs1 = supp.fc1AsCs1;

    ctrls.portamentoStepCc = supp.portamentoStep;
    ctrls.portamentoGlissCc = supp.portamentoStep > 0;
    if (supp.portamentoTime > 0) {
        // portamentoCc indexes the 0-127 rate table; AMEM stores the DX7's own
        // 0-99 parameter, so the slowest AMEM setting must reach the slowest rate.
        ctrls.portamentoCc = std::min(127, (int)std::lround((supp.portamentoTime * 127.0) / 99.0));
        ctrls.portamentoEnableCc = true;
    } else {
        ctrls.portamentoCc = 0;
        ctrls.portamentoEnableCc = false;
    }

    if (supp.pitchBendRange > 0) {
        ctrls.values_[kControllerPitch] = 0x2000;
        ctrls.values_[kControllerPitchRangeUp] = supp.pitchBendRange;
        ctrls.values_[kControllerPitchRangeDn] = supp.pitchBendRange;
    }
    ctrls.values_[kControllerPitchStep] = std::min(12, supp.pitchBendStep);
    ctrls.refresh();
}

}  // namespace texed
