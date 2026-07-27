#pragma once

#include <array>
#include <atomic>
#include <juce_audio_processors/juce_audio_processors.h>

#include "Document.h"
#include "MidiRouter.h"
#include "NativeBridge.h"
#include "engine/synth_rack.h"
#include "params/Parameters.h"

namespace texed {

/**
 * The processor owns the rack and is the single source of truth. Every value
 * lives in exactly one of two stores: the APVTS, which the host automates, or
 * the Document, which is persisted but not automatable. Whatever writes it -
 * the DAW, incoming MIDI, the WebView - goes through the store that owns it,
 * and the UI reconciles from what the editor's mirror timer sends back.
 */
class TexedProcessor : public juce::AudioProcessor, private juce::AsyncUpdater {
public:
    TexedProcessor();
    ~TexedProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    // Programs are the UI's performances. Selecting one needs the library, so
    // the request is handed to the editor; with no editor open it waits, and
    // the choice is persisted either way.
    int getNumPrograms() override { return juce::jmax(1, document.programNames.size()); }
    int getCurrentProgram() override { return document.currentProgram; }
    void setCurrentProgram(int index) override;
    const juce::String getProgramName(int index) override {
        // Before the editor has ever opened there is no list, only the one
        // program every host insists on.
        return document.programNames.isEmpty() ? "Current" : document.programNames[index];
    }
    void changeProgramName(int, const juce::String&) override {}

    /** The performance list the UI published. Message thread. */
    void setPrograms(const juce::StringArray& names, int current);
    /** The program the host asked for and the editor has not relayed yet, or -1. */
    int takeProgramRequest();

    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;

    /**
     * Message thread: decode one command from the WebView and route it to the
     * store that owns it - the APVTS, the document, or the audio thread's queue.
     */
    void handleUiCommand(const juce::var& json);

    /**
     * Message thread: apply one decoded command. Parameter-owned fields go to
     * the APVTS, the rest to the document and the audio thread's queue. For
     * `setPart`, `partFields` says which fields the patch carried.
     */
    void postCommand(const Command& cmd, unsigned partFields = 0);

    /** Meter values for the editor's mirror timer; tearing is acceptable. */
    struct Mirror {
        std::atomic<float> amps[6]{};
        std::atomic<int> steps[6]{};
        std::atomic<int> levels[6]{};
        std::atomic<int> pitchStep{4};
        std::atomic<int> pitchLevel{0};
        std::atomic<float> lfo{0};
        std::atomic<int> lfoRestart{0};
        std::atomic<int> selectedPart{0};
        std::atomic<int> partActivity[kNumParts]{};
        std::atomic<int> totalActive{0};
    };
    const Mirror& getMirror() const { return mirror; }

    Parameters& getParameters() { return params; }
    /** The part config as both stores see it: document fields plus parameters. */
    PartConfig partConfig(int index) const;
    const uint8_t* voiceFor(int index) const { return document.voices[(size_t)index].data(); }
    const uint8_t* supplementFor(int index) const {
        return document.supplements[(size_t)index].data();
    }
    int selectedPart() const { return document.selectedPart; }
    const juce::String& uiSnapshot() const { return document.uiSnapshot; }
    void setUiSnapshot(const juce::String& json) { document.uiSnapshot = json; }

    /** Bumped whenever the document changes, so the editor knows to re-send it. */
    int documentVersion() const { return docVersion; }

    /** Message thread: raw MIDI the UI has to parse, oldest first. */
    MidiForwardQueue& forwardedMidi() { return midiForward; }

    /**
     * Message thread: hold a parameter while the UI drags it, so touch
     * automation records the drag and the mirror does not echo into it.
     */
    void gesture(int part, PartParam p, bool begin);
    bool underGesture(int part, PartParam p) const { return gestures[part][(size_t)p]; }

    /** The rack's global settings as a `settings` SynthEvent. Message thread. */
    juce::var globalSettingsEvent() const;

    juce::AudioProcessorValueTreeState apvts;

private:
    void handleAsyncUpdate() override;
    void apply(const HostRequest& r);
    /** Route one AMEM byte to whichever store owns it. */
    void applySupplementByte(int part, int offset, int value);
    void publishMirror();
    void pushDocumentToRack();
    void queueCommand(const Command& cmd, const PartConfig& config);

    SynthRack rack{44100.0};
    CommandQueue queue;
    Mirror mirror;
    /** Reused by handleUiCommand so decoding a command does not allocate. */
    Command scratch;

    Parameters params;
    ParameterCache paramCache;
    Document document;
    int docVersion = 0;
    int programRequest = -1;

    HostRequestQueue hostRequests;
    MidiForwardQueue midiForward;
    MidiRouter router{rack, hostRequests, midiForward};

    std::array<std::array<bool, (size_t)kNumPartParams>, kNumParts> gestures{};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(TexedProcessor)
};

}  // namespace texed
