#include "PluginProcessor.h"

#include "PluginEditor.h"
#include "engine/engine_accuracy.h"

namespace texed {

namespace {

const juce::Identifier kRootType{"TEXED"};

/**
 * The parameter an AMEM byte belongs to, or Count when the voice keeps it.
 * Byte 5 carries two, so it is handled separately by `applySupplementByte`.
 */
PartParam supplementByteParam(int offset) {
    switch (offset) {
        case 8: return PartParam::PortamentoTime;
        case 9: return PartParam::WheelRange;
        case 12: return PartParam::FootRange;
        case 16: return PartParam::BreathRange;
        case 20: return PartParam::AftertouchRange;
        default: return PartParam::Count;
    }
}

}  // namespace

TexedProcessor::TexedProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "PARAMS", parameterLayout()) {
    params.attach(apvts);
    pushDocumentToRack();
}

void TexedProcessor::prepareToPlay(double sampleRate, int) {
    rack.setSampleRate(sampleRate);
}

bool TexedProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto& out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

PartConfig TexedProcessor::partConfig(int index) const {
    PartConfig cfg = document.configs[(size_t)index];
    params.readInto(index, cfg);
    return cfg;
}

void TexedProcessor::queueCommand(const Command& cmd, const PartConfig& config) {
    queue.push([&](Command& slot) {
        slot.type = cmd.type;
        slot.a = cmd.a;
        slot.b = cmd.b;
        slot.channel = cmd.channel;
        slot.value = cmd.value;
        slot.config = config;
        slot.hasSupplement = cmd.hasSupplement;
        slot.bytes = cmd.bytes;
    });
}

void TexedProcessor::pushDocumentToRack() {
    Command cmd;
    for (int i = 0; i < kNumParts; ++i) {
        cmd.type = CommandType::LoadVoice;
        cmd.a = i;
        cmd.hasSupplement = true;
        cmd.bytes.assign(document.voices[(size_t)i].begin(), document.voices[(size_t)i].end());
        cmd.bytes.insert(cmd.bytes.end(), document.supplements[(size_t)i].begin(),
                         document.supplements[(size_t)i].end());
        queueCommand(cmd, {});

        cmd.type = CommandType::SetPart;
        cmd.hasSupplement = false;
        cmd.bytes.clear();
        queueCommand(cmd, partConfig(i));
    }
    cmd.type = CommandType::SetAccuracy;
    cmd.a = document.dexedAccuracy ? 1 : 0;
    queueCommand(cmd, {});

    cmd.type = CommandType::SelectPart;
    cmd.a = document.selectedPart;
    queueCommand(cmd, {});
    ++docVersion;
}

void TexedProcessor::setCurrentProgram(int index) {
    if (index < 0 || index >= getNumPrograms() || index == document.currentProgram) return;
    document.currentProgram = index;
    programRequest = index;
}

int TexedProcessor::takeProgramRequest() {
    return std::exchange(programRequest, -1);
}

void TexedProcessor::setPrograms(const juce::StringArray& names, int current) {
    // -1 means the edit buffer came from a file rather than a performance, so
    // the host keeps pointing at whichever program it last selected.
    const int program = current < 0 ? document.currentProgram : current;
    if (names == document.programNames && program == document.currentProgram) return;

    document.programNames = names;
    document.currentProgram = juce::jlimit(0, juce::jmax(0, names.size() - 1), program);
    updateHostDisplay(ChangeDetails{}.withProgramChanged(true));
}

void TexedProcessor::gesture(int part, PartParam p, bool begin) {
    if (gestures[(size_t)part][(size_t)p] == begin) return;
    gestures[(size_t)part][(size_t)p] = begin;
    params.gesture(part, p, begin);
}

juce::var TexedProcessor::globalSettingsEvent() const {
    auto* settings = new juce::DynamicObject();
    settings->setProperty("engine", (int)params.get(GlobalParam::Engine));
    settings->setProperty("volume", (int)params.get(GlobalParam::Volume));
    settings->setProperty("polyphony", (int)params.get(GlobalParam::Polyphony));
    settings->setProperty("masterTuneCents", params.get(GlobalParam::MasterTune));
    // Micro-tuning tables are decoded in the UI, which owns the library, so the
    // rack only ever hears about the resulting table.
    settings->setProperty("microtuning", -1);
    settings->setProperty("accuracy", document.dexedAccuracy ? "dexed" : "hardware");
    settings->setProperty("compressor", params.get(GlobalParam::Compressor) >= 0.5f);

    auto* reverb = new juce::DynamicObject();
    reverb->setProperty("enabled", params.get(GlobalParam::ReverbEnabled) >= 0.5f);
    reverb->setProperty("size", params.get(GlobalParam::ReverbSize));
    reverb->setProperty("hiDamp", params.get(GlobalParam::ReverbHiDamp));
    reverb->setProperty("loDamp", params.get(GlobalParam::ReverbLoDamp));
    reverb->setProperty("lowpass", params.get(GlobalParam::ReverbLowpass));
    reverb->setProperty("diffusion", params.get(GlobalParam::ReverbDiffusion));
    reverb->setProperty("level", params.get(GlobalParam::ReverbLevel));
    settings->setProperty("reverb", juce::var(reverb));

    auto* msg = new juce::DynamicObject();
    msg->setProperty("type", "settings");
    msg->setProperty("settings", juce::var(settings));
    msg->setProperty("microtuningNames", juce::var(juce::Array<juce::var>{}));
    return juce::var(msg);
}

void TexedProcessor::handleUiCommand(const juce::var& json) {
    GesturePatch g;
    if (gestureFromJson(json, g)) return gesture(g.part, g.param, g.begin);

    GlobalPatch patch;
    if (globalPatchFromJson(json, patch)) {
        for (int i = 0; i < kNumGlobalParams; ++i) {
            if (patch.mask & (1u << i)) params.set((GlobalParam)i, patch.values[i]);
        }
        if (patch.hasAccuracy && patch.dexedAccuracy != document.dexedAccuracy) {
            document.dexedAccuracy = patch.dexedAccuracy;
            ++docVersion;
            Command cmd;
            cmd.type = CommandType::SetAccuracy;
            cmd.a = patch.dexedAccuracy ? 1 : 0;
            queueCommand(cmd, {});
        }
        return;
    }

    if (const auto* obj = json.getDynamicObject()) {
        const auto type = obj->getProperty("type").toString();
        // The UI owns the voice library, so its snapshot is opaque here: stored
        // with the session and handed straight back when the editor reconnects.
        if (type == "setFullState") {
            document.uiSnapshot = juce::JSON::toString(obj->getProperty("state"), true);
            return;
        }
        if (type == "programs") {
            juce::StringArray names;
            if (const auto* list = obj->getProperty("names").getArray()) {
                for (const auto& name : *list) names.add(name.toString());
            }
            return setPrograms(names, (int)obj->getProperty("index"));
        }
    }

    unsigned partFields = 0;
    if (commandFromJson(json, scratch, &partFields)) postCommand(scratch, partFields);
}

void TexedProcessor::postCommand(const Command& cmd, unsigned partFields) {
    switch (cmd.type) {
        // Global values the host owns; the audio thread picks them up next block.
        case CommandType::SetVolume: return params.set(GlobalParam::Volume, (float)cmd.a);
        case CommandType::SetEngine: return params.set(GlobalParam::Engine, (float)cmd.a);
        case CommandType::SetPolyphonyCap: return params.set(GlobalParam::Polyphony, (float)cmd.a);
        case CommandType::SetMasterTune:
            return params.set(GlobalParam::MasterTune, (float)cmd.value);

        case CommandType::LoadVoice: {
            if (cmd.bytes.size() < kVoiceSize) break;
            const int part = cmd.a >= 0 && cmd.a < kNumParts ? cmd.a : document.selectedPart;
            std::copy_n(cmd.bytes.begin(), kVoiceSize, document.voices[(size_t)part].begin());
            if (cmd.hasSupplement && cmd.bytes.size() >= kVoiceSize + kAmemSlotSize) {
                const auto* amem = cmd.bytes.data() + kVoiceSize;
                std::copy_n(amem, kAmemSlotSize, document.supplements[(size_t)part].begin());
                // The voice's own values win over whatever the knobs held.
                params.adoptSupplement(part, amem);
            }
            ++docVersion;
            break;
        }
        case CommandType::SetParam:
            if (cmd.a >= 0 && cmd.a < kVoiceSize) {
                document.voices[(size_t)document.selectedPart][(size_t)cmd.a] = (uint8_t)cmd.b;
                ++docVersion;
            }
            break;
        case CommandType::SetSupplementParam:
            applySupplementByte(document.selectedPart, cmd.a, cmd.b);
            return;
        case CommandType::SelectPart:
            if (cmd.a >= 0 && cmd.a < kNumParts) document.selectedPart = cmd.a;
            ++docVersion;
            break;
        case CommandType::SetPart: {
            if (cmd.a < 0 || cmd.a >= kNumParts) return;
            unsigned documentFields = 0;
            for (unsigned bit = 1; bit != 0; bit <<= 1) {
                if ((partFields & bit) == 0) continue;
                const auto param = partFieldParam((PartField)bit);
                if (param == PartParam::Count) {
                    documentFields |= bit;
                } else {
                    params.set(cmd.a, param, partFieldValue(cmd.config, (PartField)bit));
                }
            }
            mergePartConfig(document.configs[(size_t)cmd.a], cmd.config, documentFields);
            ++docVersion;
            queueCommand(cmd, partConfig(cmd.a));
            return;
        }
        default: break;
    }
    queueCommand(cmd, {});
}

void TexedProcessor::applySupplementByte(int part, int offset, int value) {
    if (part < 0 || part >= kNumParts || offset < 0 || offset >= kAmemSlotSize) return;

    if (offset == 5) {
        params.set(part, PartParam::Mono, (float)(value & 0x01));
        params.set(part, PartParam::PitchBendRange, (float)((value >> 2) & 0x0f));
        return;
    }
    const auto param = supplementByteParam(offset);
    if (param != PartParam::Count) return params.set(part, param, (float)value);

    document.supplements[(size_t)part][(size_t)offset] = (uint8_t)value;
    ++docVersion;

    Command cmd;
    cmd.type = CommandType::SetSupplementParam;
    cmd.a = offset;
    cmd.b = value;
    queueCommand(cmd, {});
}

void TexedProcessor::apply(const HostRequest& r) {
    switch (r.kind) {
        case HostRequest::Kind::Global:
            params.set((GlobalParam)r.index, r.value);
            break;
        case HostRequest::Kind::Part:
            params.set(r.part, (PartParam)r.index, r.value);
            break;
        case HostRequest::Kind::RxChannel: {
            document.configs[(size_t)r.part].rxChannel = (int)r.value;
            ++docVersion;
            Command cmd;
            cmd.type = CommandType::SetPart;
            cmd.a = r.part;
            queueCommand(cmd, partConfig(r.part));
            break;
        }
        case HostRequest::Kind::VoiceByte:
            // The rack already has it; this only keeps the document in step.
            document.voices[(size_t)r.part][(size_t)r.index] = (uint8_t)r.value;
            ++docVersion;
            break;
        case HostRequest::Kind::SupplementByte:
            applySupplementByte(r.part, r.index, (int)r.value);
            break;
    }
}

void TexedProcessor::handleAsyncUpdate() {
    hostRequests.drain([this](const HostRequest& r) { apply(r); });
}

void TexedProcessor::publishMirror() {
    const auto& s = rack.getStatus();
    for (int op = 0; op < 6; ++op) {
        mirror.amps[op].store(s.part.amps[op], std::memory_order_relaxed);
        mirror.steps[op].store(s.part.steps[op], std::memory_order_relaxed);
        mirror.levels[op].store(s.part.levels[op], std::memory_order_relaxed);
    }
    mirror.pitchStep.store(s.part.pitchStep, std::memory_order_relaxed);
    mirror.pitchLevel.store(s.part.pitchLevel, std::memory_order_relaxed);
    mirror.lfo.store(s.part.lfo, std::memory_order_relaxed);
    mirror.lfoRestart.store(s.part.lfoRestart, std::memory_order_relaxed);
    mirror.selectedPart.store(s.selectedPart, std::memory_order_relaxed);
    for (int i = 0; i < kNumParts; ++i) {
        mirror.partActivity[i].store(s.partActivity[i], std::memory_order_relaxed);
    }
    mirror.totalActive.store(s.totalActive, std::memory_order_relaxed);
}

void TexedProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;

    queue.drain([this](const Command& cmd) { applyCommand(rack, cmd); });
    applyParameters(params, rack, paramCache);
    router.process(midi);
    if (hostRequests.pending()) triggerAsyncUpdate();

    const int numSamples = buffer.getNumSamples();
    buffer.clear();
    if (buffer.getNumChannels() >= 2) {
        rack.render(buffer.getWritePointer(0), buffer.getWritePointer(1), numSamples);
    } else if (buffer.getNumChannels() == 1) {
        auto* mono = buffer.getWritePointer(0);
        rack.render(mono, mono, numSamples);
    }

    publishMirror();
}

void TexedProcessor::getStateInformation(juce::MemoryBlock& dest) {
    juce::ValueTree root{kRootType};
    root.appendChild(apvts.copyState(), nullptr);
    root.appendChild(document.writeTo(), nullptr);
    juce::MemoryOutputStream out(dest, false);
    root.writeToStream(out);
}

void TexedProcessor::setStateInformation(const void* data, int size) {
    juce::MemoryInputStream in(data, (size_t)size, false);
    const auto root = juce::ValueTree::readFromStream(in);
    if (!root.hasType(kRootType)) return;

    const auto state = root.getChildWithName(apvts.state.getType());
    if (state.isValid()) apvts.replaceState(state);
    document.readFrom(root.getChildWithName(Document::kType));
    // The same path an editor edit takes, so restoring needs no editor.
    pushDocumentToRack();
}

juce::AudioProcessorEditor* TexedProcessor::createEditor() {
    return new TexedEditor(*this);
}

}  // namespace texed

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new texed::TexedProcessor();
}
