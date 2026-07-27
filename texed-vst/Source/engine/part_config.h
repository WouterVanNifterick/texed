// Multi-timbral part configuration. Port of the engine-facing fields of
// dx7-format/src/part-config.ts. The voice reference is deliberately absent:
// the voice library lives in TypeScript, which sends resolved voices down.

#pragma once

namespace texed {

constexpr int kNumParts = 8;

inline bool inNoteRange(int pitch, int low, int high) {
    return low <= high ? (pitch >= low && pitch <= high) : (pitch <= high || pitch >= low);
}

// The continuous fields are double rather than float: they are arithmetic
// operands in the mix and the filter, where the TypeScript engine works in
// double throughout, and a narrower type here would show up in the null test.
struct PartConfig {
    bool enabled = false;
    /** 0 = omni (all channels), 1..16 = specific MIDI channel. */
    int rxChannel = 0;
    double volume = 1.0;
    double pan = 0.0;
    int noteLow = 0;
    int noteHigh = 127;
    int noteShift = 0;
    int detune = 0;
    /** Ladder filter cutoff 0..1; 1 bypasses the filter. */
    double cutoff = 1.0;
    double resonance = 0.0;
    /** Send into the global plate reverb, 0..1. */
    double reverbSend = 0.0;
    /** TX802 EG Forced Damp (per instrument). */
    bool forcedDamp = true;
    /** TX802 Linked Tone Generator: chained to the nearest non-linked part above. */
    bool link = false;
    /**
     * The library slot this part was loaded from. Opaque to the rack: the voice
     * library lives in the UI, which resolves a slot to bytes before sending it
     * down and only ever gets these fields back the way it set them.
     */
    char voiceBank[16]{};
    int voiceProgram = 0;
};

/** Fields present in a `setPart` patch, so a merge can stay message-thread. */
enum PartField {
    PartFieldEnabled = 1 << 0,
    PartFieldRxChannel = 1 << 1,
    PartFieldVolume = 1 << 2,
    PartFieldPan = 1 << 3,
    PartFieldNoteLow = 1 << 4,
    PartFieldNoteHigh = 1 << 5,
    PartFieldNoteShift = 1 << 6,
    PartFieldDetune = 1 << 7,
    PartFieldCutoff = 1 << 8,
    PartFieldResonance = 1 << 9,
    PartFieldReverbSend = 1 << 10,
    PartFieldForcedDamp = 1 << 11,
    PartFieldLink = 1 << 12,
    PartFieldVoice = 1 << 13,
};

/** Overwrite the fields of `dst` that `mask` marks as present in `patch`. */
void mergePartConfig(PartConfig& dst, const PartConfig& patch, unsigned mask);

/** Where a control change belongs once the rack has had a look at it. */
enum class CcRouting {
    /** Not the rack's: hand it to the part. */
    Voice,
    /** The rack's, and `cfg` changed with it. */
    Config,
    /** The rack's, with no effect on `cfg`. */
    Consumed,
};

/**
 * Mixer and channel-mode control changes, which belong to the rack rather than
 * to a voice. Free-standing so the audio thread and the message thread can run
 * the same transform over their own copies of a config instead of sharing one.
 */
CcRouting applyMixerCc(PartConfig& cfg, int& preOmniChannel, int ctrl, int value);

}  // namespace texed
