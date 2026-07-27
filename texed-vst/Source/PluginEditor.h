#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#include "PluginProcessor.h"

namespace texed {

/**
 * Hosts the React app and is the only thing that talks to it. Commands arrive
 * on the JUCE backend channel and are routed by the processor; a 30 Hz timer
 * mirrors the processor's state back as `SynthEvent`s. Nothing here holds synth
 * state of its own beyond what it last sent, which is what the diff needs.
 */
class TexedEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit TexedEditor(TexedProcessor&);

    void paint(juce::Graphics&) override;
    void resized() override;

    /** True once the page has loaded and asked for its state. */
    bool isConnected() const { return ready; }

    /** Test hook: run JS in the WebView and pass the stringified result to cb. */
    void evaluateInPage(const juce::String& script, std::function<void(juce::String)> cb);

private:
    void timerCallback() override;
    void sendInitialState();
    void sendVoice();
    void sendParts();
    void sendSettings();
    /** Emit anything a parameter move, an edit or incoming MIDI has changed. */
    void sendChanges();
    void send(const juce::var& event);
    void beginPageLoad();
    void syncWebViewBounds();

    TexedProcessor& processor;
    /** Declared before the WebView, whose options are built from it. */
    juce::WebControlParameterIndexReceiver paramIndexReceiver;
    juce::WebBrowserComponent webView;
    /** Shown instead of the WebView when the WebView2 runtime is missing. */
    juce::Label runtimeNotice;
    juce::HyperlinkButton runtimeLink;

    /** Set once the page has asked for its state; before that, events are lost. */
    bool ready = false;
    bool pageLoadStarted = false;
    int lastDocVersion = -1;
    float lastGlobals[kNumGlobalParams];
    float lastParts[kNumParts][kNumPartParams];

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(TexedEditor)
};

}  // namespace texed
