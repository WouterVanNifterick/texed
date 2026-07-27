#include "PluginEditor.h"

#include "WebAssets.h"

namespace texed {

namespace {

constexpr const char* kCommandEvent = "texedCommand";
constexpr const char* kSynthEvent = "texedEvent";
constexpr const char* kReadyEvent = "texedReady";

/** Cache folder of our own, so the host does not sweep it mid-session. */
juce::File webViewUserDataFolder() {
    auto dir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                   .getChildFile("Texed")
                   .getChildFile("WebView");
    dir.createDirectory();
    return dir;
}

template <typename T>
juce::var makeArray(const T* values, int count) {
    juce::Array<juce::var> out;
    for (int i = 0; i < count; ++i) out.add(values[i]);
    return out;
}

juce::var event(const char* type) {
    auto* msg = new juce::DynamicObject();
    msg->setProperty("type", type);
    return juce::var(msg);
}

}  // namespace

TexedEditor::TexedEditor(TexedProcessor& p)
    : AudioProcessorEditor(&p),
      processor(p),
      webView(juce::WebBrowserComponent::Options{}
                  .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
                  .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}
                                              .withUserDataFolder(webViewUserDataFolder())
                                              .withBackgroundColour(juce::Colour(0xff0d0f14)))
                  .withKeepPageLoadedWhenBrowserIsHidden()
                  .withNativeIntegrationEnabled()
                  .withResourceProvider(lookupWebAsset)
                  .withOptionsFrom(paramIndexReceiver)
                  .withEventListener(kCommandEvent,
                                     [this](juce::var payload) {
                                         processor.handleUiCommand(payload);
                                     })
                  .withEventListener(kReadyEvent, [this](juce::var) { sendInitialState(); })),
      runtimeLink("Download the WebView2 runtime",
                  juce::URL("https://developer.microsoft.com/microsoft-edge/webview2/")) {
    setResizable(true, true);
    // The React app lays out on a 1440x1020 stage and scales to fit, so open at
    // exactly that and let it shrink from there.
    setResizeLimits(720, 510, 3840, 2160);
    setSize(1440, 1020);

    if (!webViewRuntimeAvailable()) {
        // Without it the WebView is a blank rectangle, which reads as a broken
        // plugin. The audio engine is unaffected and keeps playing.
        runtimeNotice.setText("Texed needs the Microsoft Edge WebView2 runtime to show its "
                              "interface.\nThe sound engine is running; only the editor is "
                              "unavailable.",
                              juce::dontSendNotification);
        runtimeNotice.setJustificationType(juce::Justification::centred);
        runtimeNotice.setColour(juce::Label::textColourId, juce::Colours::white);
        addAndMakeVisible(runtimeNotice);
        addAndMakeVisible(runtimeLink);
        return;
    }

    addAndMakeVisible(webView);

    for (int i = 0; i < kNumGlobalParams; ++i) {
        lastGlobals[i] = processor.getParameters().get((GlobalParam)i);
    }
    for (int part = 0; part < kNumParts; ++part) {
        for (int i = 0; i < kNumPartParams; ++i) {
            lastParts[part][i] = processor.getParameters().get(part, (PartParam)i);
        }
    }

    // Navigation waits until the host has given us a real size. Starting in the
    // constructor races standalone window setup and leaves WebView2 at 0x0.
    startTimerHz(30);
}

void TexedEditor::beginPageLoad() {
    if (pageLoadStarted || getWidth() <= 0 || getHeight() <= 0 || !webView.isVisible()) return;
    pageLoadStarted = true;
    webView.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}

void TexedEditor::syncWebViewBounds() {
    if (!webView.isVisible()) return;
    webView.setBounds(getLocalBounds());
}

void TexedEditor::evaluateInPage(const juce::String& script, std::function<void(juce::String)> cb) {
    if (!webView.isVisible()) {
        cb({});
        return;
    }
    webView.evaluateJavascript(script, [cb = std::move(cb)](const juce::WebBrowserComponent::EvaluationResult& r) {
        if (const auto* err = r.getError()) {
            cb("error: " + err->message);
            return;
        }
        cb(r.getResult() != nullptr ? r.getResult()->toString() : juce::String{});
    });
}

void TexedEditor::paint(juce::Graphics& g) {
    if (!webView.isVisible()) g.fillAll(juce::Colours::black);
}

void TexedEditor::resized() {
    if (!webView.isVisible()) {
        auto area = getLocalBounds().withSizeKeepingCentre(getWidth(), 100);
        runtimeNotice.setBounds(area.removeFromTop(70));
        runtimeLink.setBounds(area);
        return;
    }
    webView.setBounds(getLocalBounds());
    beginPageLoad();
}

void TexedEditor::send(const juce::var& e) {
    webView.emitEventIfBrowserIsVisible(kSynthEvent, e);
}

void TexedEditor::sendVoice() {
    auto msg = event("voice");
    const int part = processor.selectedPart();
    msg.getDynamicObject()->setProperty("data", binaryVar(processor.voiceFor(part), kVoiceSize));
    msg.getDynamicObject()->setProperty(
        "supplement", binaryVar(processor.supplementFor(part), kAmemSlotSize));
    send(msg);
}

void TexedEditor::sendParts() {
    juce::Array<juce::var> configs;
    juce::Array<juce::var> voiceNames;
    for (int i = 0; i < kNumParts; ++i) {
        const auto c = processor.partConfig(i);
        auto* voice = new juce::DynamicObject();
        voice->setProperty("bank", juce::String(c.voiceBank));
        voice->setProperty("program", c.voiceProgram);

        auto* obj = new juce::DynamicObject();
        obj->setProperty("voice", juce::var(voice));
        obj->setProperty("enabled", c.enabled);
        obj->setProperty("rxChannel", c.rxChannel);
        obj->setProperty("volume", c.volume);
        obj->setProperty("pan", c.pan);
        obj->setProperty("noteLow", c.noteLow);
        obj->setProperty("noteHigh", c.noteHigh);
        obj->setProperty("noteShift", c.noteShift);
        obj->setProperty("detune", c.detune);
        obj->setProperty("cutoff", c.cutoff);
        obj->setProperty("resonance", c.resonance);
        obj->setProperty("reverbSend", c.reverbSend);
        obj->setProperty("forcedDamp", c.forcedDamp);
        obj->setProperty("link", c.link);
        configs.add(juce::var(obj));

        char name[11];
        getVoiceName(processor.voiceFor(i), name);
        voiceNames.add(juce::String(name));
    }

    auto msg = event("parts");
    msg.getDynamicObject()->setProperty("configs", juce::var(configs));
    msg.getDynamicObject()->setProperty("voiceNames", juce::var(voiceNames));
    msg.getDynamicObject()->setProperty("selectedPart", processor.selectedPart());
    send(msg);
}

void TexedEditor::sendSettings() {
    send(processor.globalSettingsEvent());
}

void TexedEditor::sendInitialState() {
    ready = true;
    syncWebViewBounds();
    evaluateInPage("window.dispatchEvent(new Event('resize'))", [](juce::String) {});
    // The library, performances and micro-tunings live in the UI; hand back the
    // snapshot the session was saved with so it can put them back.
    const auto& snapshot = processor.uiSnapshot();
    if (snapshot.isNotEmpty()) {
        auto msg = event("fullState");
        msg.getDynamicObject()->setProperty("state", juce::JSON::parse(snapshot));
        send(msg);
    }
    sendVoice();
    sendSettings();
    sendParts();
}

void TexedEditor::sendChanges() {
    bool settings = false;
    for (int i = 0; i < kNumGlobalParams; ++i) {
        const float value = processor.getParameters().get((GlobalParam)i);
        settings |= value != lastGlobals[i];
        lastGlobals[i] = value;
    }
    if (settings) sendSettings();

    bool parts = false;
    for (int part = 0; part < kNumParts; ++part) {
        for (int i = 0; i < kNumPartParams; ++i) {
            // A control being dragged already has the value; echoing it back
            // mid-drag would fight the drag.
            if (processor.underGesture(part, (PartParam)i)) continue;
            const float value = processor.getParameters().get(part, (PartParam)i);
            parts |= value != lastParts[part][i];
            lastParts[part][i] = value;
        }
    }

    const int version = processor.documentVersion();
    const bool document = version != lastDocVersion;
    lastDocVersion = version;
    if (parts || document) sendParts();
    if (document) sendVoice();

    // A program the host picked while the window was shut is a one-shot event,
    // so it waits for the page rather than being dropped on the way out.
    const int program = ready ? processor.takeProgramRequest() : -1;
    if (program >= 0) {
        auto msg = event("selectProgram");
        msg.getDynamicObject()->setProperty("index", program);
        send(msg);
    }

    processor.forwardedMidi().drain([this](const uint8_t* data, int size) {
        auto msg = event("midi");
        msg.getDynamicObject()->setProperty("data", binaryVar(data, (size_t)size));
        send(msg);
    });
}

void TexedEditor::timerCallback() {
    beginPageLoad();
    if (!ready) syncWebViewBounds();
    sendChanges();

    const auto& m = processor.getMirror();
    float amps[6];
    int steps[6];
    int levels[6];
    for (int i = 0; i < 6; ++i) {
        amps[i] = m.amps[i].load(std::memory_order_relaxed);
        steps[i] = m.steps[i].load(std::memory_order_relaxed);
        levels[i] = m.levels[i].load(std::memory_order_relaxed);
    }
    int activity[kNumParts];
    for (int i = 0; i < kNumParts; ++i) {
        activity[i] = m.partActivity[i].load(std::memory_order_relaxed);
    }

    auto msg = event("status");
    auto* obj = msg.getDynamicObject();
    obj->setProperty("amps", makeArray(amps, 6));
    obj->setProperty("steps", makeArray(steps, 6));
    obj->setProperty("levels", makeArray(levels, 6));
    obj->setProperty("pitchStep", m.pitchStep.load(std::memory_order_relaxed));
    obj->setProperty("pitchLevel", m.pitchLevel.load(std::memory_order_relaxed));
    obj->setProperty("lfo", m.lfo.load(std::memory_order_relaxed));
    obj->setProperty("lfoRestart", m.lfoRestart.load(std::memory_order_relaxed));
    obj->setProperty("selectedPart", m.selectedPart.load(std::memory_order_relaxed));
    obj->setProperty("partActivity", makeArray(activity, kNumParts));
    obj->setProperty("totalActive", m.totalActive.load(std::memory_order_relaxed));
    send(msg);
}

}  // namespace texed
