#include "part_config.h"

#include <cmath>
#include <cstring>

namespace texed {

void mergePartConfig(PartConfig& dst, const PartConfig& patch, unsigned mask) {
    if (mask & PartFieldEnabled) dst.enabled = patch.enabled;
    if (mask & PartFieldRxChannel) dst.rxChannel = patch.rxChannel;
    if (mask & PartFieldVolume) dst.volume = patch.volume;
    if (mask & PartFieldPan) dst.pan = patch.pan;
    if (mask & PartFieldNoteLow) dst.noteLow = patch.noteLow;
    if (mask & PartFieldNoteHigh) dst.noteHigh = patch.noteHigh;
    if (mask & PartFieldNoteShift) dst.noteShift = patch.noteShift;
    if (mask & PartFieldDetune) dst.detune = patch.detune;
    if (mask & PartFieldCutoff) dst.cutoff = patch.cutoff;
    if (mask & PartFieldResonance) dst.resonance = patch.resonance;
    if (mask & PartFieldReverbSend) dst.reverbSend = patch.reverbSend;
    if (mask & PartFieldForcedDamp) dst.forcedDamp = patch.forcedDamp;
    if (mask & PartFieldLink) dst.link = patch.link;
    if (mask & PartFieldVoice) {
        std::memcpy(dst.voiceBank, patch.voiceBank, sizeof(dst.voiceBank));
        dst.voiceProgram = patch.voiceProgram;
    }
}

CcRouting applyMixerCc(PartConfig& cfg, int& preOmniChannel, int ctrl, int value) {
    const double norm = value / 127.0;
    switch (ctrl) {
        case 7: cfg.volume = norm; break;
        case 10: cfg.pan = (value - 64) / 64.0; break;
        case 71: cfg.resonance = norm; break;
        case 74: cfg.cutoff = norm; break;
        case 91: cfg.reverbSend = norm; break;
        // Onto the same -7..+7 the part rack offers. Rounds half up, the way
        // Math.round does, rather than away from zero.
        case 94: cfg.detune = (int)std::floor(((value - 64) / 64.0) * 7 + 0.5); break;
        case 124: cfg.rxChannel = preOmniChannel; break;
        case 125: cfg.rxChannel = 0; break;
        // Bank select resolves against the voice library, which lives in the UI,
        // so the rack has nothing to do with it.
        case 0:
        case 32: return CcRouting::Consumed;
        default: return CcRouting::Voice;
    }
    // Remember the last explicit channel so CC 124 (omni off) has something to
    // go back to instead of guessing.
    if (cfg.rxChannel != 0) preOmniChannel = cfg.rxChannel;
    return CcRouting::Config;
}

}  // namespace texed
