// A single DX7 "part" (timbre). Port of dx7-engine/src/part.ts: owns its voice
// pool, controllers, LFO and the current 156-byte voice, and renders mono audio.
//
// A Part renders mono and applies NO global FX: the rack owns the
// filter / master-gain / pan stage.

#pragma once

#include <array>
#include <cstdint>
#include <memory>
#include <vector>

// synth.h first: the msfa headers below expect its integer typedefs.
#include "../msfa/synth.h"

#include "../EngineMkI.h"
#include "../EngineOpl.h"
#include "../msfa/fm_core.h"
#include "amem.h"
#include "controllers.h"
#include "dx7note.h"
#include "lfo.h"
#include "tuning.h"
#include "voice.h"

namespace texed {

constexpr int kMaxActiveNotes = 32;

enum class EngineType { Modern = 0, MarkI = 1, Opl = 2 };

/** Live envelope and LFO state for one part, as shown on the meters. */
struct PartStatus {
    float amps[6]{};
    int steps[6] = {4, 4, 4, 4, 4, 4};
    int32_t levels[6]{};
    int pitchStep = 4;
    int32_t pitchLevel = 0;
    float lfo = 0;
    int lfoRestart = 0;
};

class Part {
public:
    Part();

    void setEngineType(EngineType type);
    void loadVoice(const uint8_t* patch);
    /** Load VMEM + AMEM together (DX7II bank slot). */
    void loadVoiceSlot(const uint8_t* vmem, const uint8_t* amem);
    const uint8_t* getVoiceData() const { return data.data(); }
    const uint8_t* getSupplementData() const { return supplement.raw.data(); }
    /** Edit one byte of the 35-byte AMEM supplement and re-apply it. */
    void setSupplementParam(int offset, int value);
    void setVoiceParam(int offset, int value);

    void setMasterTuneCents(double cents);
    /** Swap the whole tuning table (standard or a micro-tuning). */
    void setTuning(std::shared_ptr<TuningState> state);

    /** Silence all active voices before a full program/voice swap. */
    void clearActiveVoices();

    void noteOn(int pitch, int velocity, int channel = 1);
    void noteOff(int pitch, int channel = 1);
    void controlChange(int ctrl, int value);
    void setMonoMode(bool on) { monoMode = on; }
    void aftertouch(int value);
    void pitchBend(int value14);
    void panic();

    /** Voices producing sound and counting toward the polyphony budget. */
    int activeVoiceCount() const;
    bool hasActiveVoices() const;

    struct StealCandidate {
        bool valid = false;
        int seq = 0;
        bool released = false;
    };
    /** Prefer a released (key-up) voice, else the oldest key-down voice. */
    StealCandidate stealCandidate() const;
    /** Free the oldest matching voice for a cross-part steal, click-free. */
    void killOldest();

    const PartStatus& getStatus();

    /** Render `numSamples` mono samples into `out` (overwrites). */
    void render(float* out, int numSamples);

    /** Performance-level transpose (semitones), added to engine pitch only. */
    int extraTranspose = 0;
    /** Performance-level detune in cents (-7..+7). */
    int extraDetune = 0;
    /** TX802 EG Forced Damp. ON: a stolen voice restarts its envelope. */
    bool forcedDamp = true;

private:
    struct Voice {
        std::unique_ptr<Dx7Note> note;
        int midiNote = -1;
        int velocity = 0;
        int channel = 1;
        bool keydown = false;
        /** Held by the sustain pedal (CC 64). */
        bool sustained = false;
        /** Held by sostenuto (CC 66): keys that were down when it engaged. */
        bool sostenuto = false;
        /** Held by hold-2 (CC 69), which lets go on the next fresh phrase. */
        bool hold2 = false;
        bool live = false;
        int keydownSeq = -1;
        /** Forced-damp fade in progress: audible, but no longer a steal candidate. */
        bool damping = false;
    };

    void applySupplementToParts();
    void refreshVoices();
    int chooseNote(int pitch) const;
    int transpositionShift() const;
    double enginePitch(int midiNote) const;
    void triggerVoice(int pitch, int velocity, int channel, double detuneCents);
    bool anyKeyDown() const;
    void keyUp(Voice& v);
    /** Let a voice go once no pedal is still holding it. */
    void maybeRelease(Voice& v);
    void setSustain(bool on);
    void setSostenuto(bool on);
    void setHold2(bool on);
    void updateBendGates();

    std::shared_ptr<TuningState> tuningState = createStandardTuning();
    Controllers controllers;
    Lfo lfo;
    FmCore modern;
    EngineMkI mki;
    EngineOpl opl;

    std::array<Voice, kMaxActiveNotes> voices;
    std::array<uint8_t, kVoiceSize> data{};
    VoiceSupplement supplement;
    bool monoMode = false;

    int currentNote = 0;
    int nextKeydownSeq = 0;
    int lastActiveVoice = 0;
    bool sustain = false;
    bool hold2 = false;

    int32_t lastLfoValue = 0;
    int32_t lastLfoDelay = 0;
    int lfoRestartSeq = 0;
    VoiceStatus peekStatus;
    PartStatus status;

    std::array<float, N> extraBuf{};
    int extraBufSize = 0;
    std::array<int32_t, N> audiobuf{};
    std::array<float, N> sumbuf{};
};

}  // namespace texed
