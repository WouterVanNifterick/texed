// texed-headless: drives the plugin with no editor, which is the case a DAW
// puts it in most of the time - a session loads and transport rolls without the
// window ever opening. Everything the UI would normally do has to already be in
// the document and the parameters, so this is where that gets proven.
//
// Prints one line per check and exits non-zero on the first failure.

#include "../PluginEditor.h"
#include "../PluginProcessor.h"
#include "../WebAssets.h"

extern juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter();

namespace {

constexpr double kSampleRate = 44100.0;
constexpr int kBlockSize = 512;

int failures = 0;

void check(bool ok, const juce::String& what) {
    std::cout << (ok ? "  ok   " : "  FAIL ") << what << std::endl;
    if (!ok) ++failures;
}

/** Render `blocks` of silence-plus-midi and return the peak sample. */
float run(juce::AudioProcessor& p, juce::MidiBuffer midi, int blocks) {
    juce::AudioBuffer<float> buffer(2, kBlockSize);
    float peak = 0;
    for (int i = 0; i < blocks; ++i) {
        buffer.clear();
        p.processBlock(buffer, midi);
        midi.clear();
        peak = juce::jmax(peak, buffer.getMagnitude(0, kBlockSize));
        // Parameter writes from MIDI land on the message thread, so let the
        // async update through between blocks the way a host's would.
        juce::MessageManager::getInstance()->runDispatchLoopUntil(1);
    }
    return peak;
}

juce::MidiBuffer note(int number, int velocity, int channel = 1) {
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(channel, number, (juce::uint8)velocity), 0);
    return midi;
}

juce::MidiBuffer allNotesOff() {
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::allNotesOff(1), 0);
    return midi;
}

/** A TX816 performance parameter frame: F0 43 1n 04 par val F7. */
juce::MidiBuffer performance(int part, int param, int value) {
    const uint8_t body[] = {0x43, (uint8_t)(0x10 | part), 0x04, (uint8_t)param, (uint8_t)value};
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::createSysExMessage(body, (int)sizeof(body)), 0);
    return midi;
}

/**
 * Open the editor and wait for the page to say hello. A WebView that serves its
 * assets but never runs them looks exactly like a working plugin from the C++
 * side, so this is the only check that catches a broken bundle.
 */
void checkEditorConnects(juce::AudioProcessor& p) {
    // Windows only: this needs a real WebView, and the GTK one CI would use has
    // no working renderer in a container.
    if (!JUCE_WINDOWS || !texed::webViewRuntimeAvailable()) {
        std::cout << "  skip  no WebView runtime" << std::endl;
        return;
    }

    std::unique_ptr<juce::AudioProcessorEditor> editor{p.createEditorIfNeeded()};
    editor->setSize(1440, 1020);

    // Standalone wraps the editor in a DocumentWindow; addToDesktop alone misses
    // that path and can hide WebView2 compositing bugs.
    struct HostWindow : juce::DocumentWindow {
        HostWindow() : DocumentWindow("Texed", juce::Colours::black, DocumentWindow::allButtons) {}
        void closeButtonPressed() override {}
    } host;
    host.setContentNonOwned(editor.get(), true);
    host.setUsingNativeTitleBar(true);
    host.centreWithSize(1440, 1020);
    host.setVisible(true);

    auto* view = static_cast<texed::TexedEditor*>(editor.get());
    const auto deadline = juce::Time::getMillisecondCounter() + 30000;
    while (!view->isConnected() && juce::Time::getMillisecondCounter() < deadline) {
        juce::MessageManager::getInstance()->runDispatchLoopUntil(100);
    }

    if (!view->isConnected()) {
        bool probeDone = false;
        juce::String probe;
        view->evaluateInPage(
            R"(JSON.stringify({
              juce: typeof window.__JUCE__,
              backend: typeof window.__JUCE__?.backend,
              rootLen: document.getElementById('root')?.innerHTML?.length ?? 0,
              title: document.title,
              errors: window.__texedLoadErrors || []
            }))",
            [&](juce::String result) {
                probe = result;
                probeDone = true;
            });
        while (!probeDone && juce::Time::getMillisecondCounter() < deadline + 5000) {
            juce::MessageManager::getInstance()->runDispatchLoopUntil(50);
        }
        if (probe.isNotEmpty()) std::cout << "  probe " << probe << std::endl;
    }

    check(view->isConnected(), "the page loads and connects to the plugin");

    if (view->isConnected()) {
        bool probeDone = false;
        juce::String probe;
        view->evaluateInPage(
            R"(JSON.stringify({
              rootLen: document.getElementById('root')?.innerHTML?.length ?? 0,
              appRoot: !!document.querySelector('.app-root'),
              topBar: !!document.querySelector('.topbar')
            }))",
            [&](juce::String result) {
                probe = result;
                probeDone = true;
            });
        while (!probeDone && juce::Time::getMillisecondCounter() < deadline + 5000) {
            juce::MessageManager::getInstance()->runDispatchLoopUntil(50);
        }
        if (probe.isNotEmpty()) std::cout << "  ui    " << probe << std::endl;
        check(probe.contains("appRoot") && probe.contains("true"), "the UI rendered in the WebView");
    }
}

/** The `programs` message the UI's bridge sends after a performance change. */
juce::var programs(const juce::StringArray& names, int index) {
    juce::Array<juce::var> list;
    for (const auto& name : names) list.add(name);

    auto* msg = new juce::DynamicObject();
    msg->setProperty("type", "programs");
    msg->setProperty("names", list);
    msg->setProperty("index", index);
    return juce::var(msg);
}

/**
 * Programs are the UI's performances, so the plugin only knows the ones the UI
 * published. The list and the choice have to outlive the editor either way.
 */
void checkPrograms(texed::TexedProcessor& p) {
    check(p.getNumPrograms() == 1, "one placeholder program before the UI has spoken");

    p.handleUiCommand(programs({"Split Bass", "Layered Pad", "Brass Section"}, 0));
    check(p.getNumPrograms() == 3, "the UI's performances become programs");
    check(p.getProgramName(1) == "Layered Pad", "programs keep their names");

    p.setCurrentProgram(2);
    check(p.getCurrentProgram() == 2, "the host's choice sticks");
    check(p.takeProgramRequest() == 2, "the choice is relayed to the UI once");
    check(p.takeProgramRequest() == -1, "and not a second time");

    juce::MemoryBlock saved;
    p.getStateInformation(saved);
    std::unique_ptr<juce::AudioProcessor> restored{createPluginFilter()};
    restored->setStateInformation(saved.getData(), (int)saved.getSize());
    check(restored->getProgramName(2) == "Brass Section" && restored->getCurrentProgram() == 2,
          "programs survive a state round trip");
}

/**
 * A one-patch library in a scratch folder, so the check runs on a machine with
 * nothing installed. TEXED_LIBRARY wins when it is set, which is how a real
 * library gets tested. Has to run before the first lookup resolves the folder.
 */
juce::File standInLibrary() {
    const auto dir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                         .getChildFile("texed-headless-library");
    if (juce::SystemStats::getEnvironmentVariable("TEXED_LIBRARY", {}).isEmpty()) {
        const auto patch = dir.getChildFile("collection/patch.syx");
        patch.getParentDirectory().createDirectory();
        patch.replaceWithData("\xf0\xf7", 2);
#if JUCE_WINDOWS
        _putenv_s("TEXED_LIBRARY", dir.getFullPathName().toRawUTF8());
#else
        setenv("TEXED_LIBRARY", dir.getFullPathName().toRawUTF8(), 1);
#endif
    }
    return dir;
}

/**
 * The editor serves the UI itself, so a missing asset is a blank window rather
 * than a 404 anyone would notice. Checked here because it needs no editor.
 */
void checkWebAssets() {
    const auto index = texed::lookupWebAsset("/");
    check(index.has_value(), "the editor serves index.html");

    // Vite hashes the bundle's file names, so a stale embedded copy still has an
    // index.html but none of the scripts it asks for, and the window is black.
    if (index.has_value()) {
        const auto html = juce::String::createStringFromData(index->data.data(),
                                                            (int)index->data.size());
        int missing = 0;
        for (const auto& part : juce::StringArray::fromTokens(html, "\"", "")) {
            if (!part.startsWith("/assets/") && !part.startsWith("/texed/assets/")
                && !part.startsWith("/src/") && !part.startsWith("/@"))
                continue;
            if (!texed::lookupWebAsset(part).has_value()) {
                std::cout << "  miss  " << part << std::endl;
                ++missing;
            }
        }
        check(missing == 0, "and every asset index.html asks for");
    }

    const auto scratch = standInLibrary();
    const auto library = texed::patchLibraryFolder();
    // Collections sit in subfolders, so the manifest's paths have a slash in
    // them and the leaf name alone is not enough to find the file.
    const auto nested = library.findChildFiles(juce::File::findFiles, true, "*.syx");
    if (nested.isEmpty()) return check(false, "the patch library holds no .syx");

    const auto path = "/library/" + nested[0].getRelativePathFrom(library).replaceCharacter('\\', '/');
    check(texed::lookupWebAsset(path).has_value(), "the editor serves " + path);
    check(!texed::lookupWebAsset("/library/../../secret.txt").has_value(),
          "a URL cannot walk out of the library");

    scratch.deleteRecursively();
}

}  // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juceInit;

    std::cout << "editor-closed checks" << std::endl;

    std::unique_ptr<juce::AudioProcessor> p{createPluginFilter()};
    p->prepareToPlay(kSampleRate, kBlockSize);
    check(p->getActiveEditor() == nullptr, "no editor was created");

    check(run(*p, note(60, 100), 8) > 0.01f, "a note sounds with no editor");

    // A performance parameter has to reach the parameter the host automates,
    // not a copy of it, or the two disagree the moment the host writes.
    auto& apvts = static_cast<texed::TexedProcessor*>(p.get())->apvts;
    auto* mono = apvts.getParameter(texed::parameterId(1, texed::PartParam::Mono));
    run(*p, performance(1, 2, 1), 4);
    check(mono->convertFrom0to1(mono->getValue()) == 1.0f, "TX816 mono lands in the parameter");

    auto* volume = apvts.getParameter(texed::parameterId(0, texed::PartParam::Volume));
    volume->setValueNotifyingHost(volume->convertTo0to1(0.0f));
    // Let the earlier note release and the gain ramp reach the new value first.
    run(*p, allNotesOff(), 40);
    check(run(*p, note(64, 100), 8) < 0.001f, "part volume silences the part");
    volume->setValueNotifyingHost(volume->convertTo0to1(1.0f));
    run(*p, allNotesOff(), 40);

    // Save, change something, restore: the session has to come back without an
    // editor to re-send it.
    auto* cutoff = apvts.getParameter(texed::parameterId(0, texed::PartParam::Cutoff));
    cutoff->setValueNotifyingHost(cutoff->convertTo0to1(0.25f));
    juce::MemoryBlock saved;
    p->getStateInformation(saved);
    cutoff->setValueNotifyingHost(cutoff->convertTo0to1(0.9f));

    std::unique_ptr<juce::AudioProcessor> restored{createPluginFilter()};
    restored->setStateInformation(saved.getData(), (int)saved.getSize());
    restored->prepareToPlay(kSampleRate, kBlockSize);
    auto& other = static_cast<texed::TexedProcessor*>(restored.get())->apvts;
    const auto* back = other.getParameter(texed::parameterId(0, texed::PartParam::Cutoff));
    check(std::abs(back->convertFrom0to1(back->getValue()) - 0.25f) < 1.0e-6f,
          "parameters survive a state round trip");
    check(run(*restored, note(60, 100), 8) > 0.01f, "the restored plugin sounds");

    checkPrograms(*static_cast<texed::TexedProcessor*>(p.get()));
    checkWebAssets();
    checkEditorConnects(*p);

    std::cout << (failures == 0 ? "all checks passed" : "checks failed") << std::endl;
    return failures == 0 ? 0 : 1;
}
