#include "NativeBridge.h"

#include <cstring>

#include "engine/engine_accuracy.h"
#include "engine/tables.h"

namespace texed {

namespace {

int intProp(const juce::var& v, const char* key, int fallback = 0) {
    const auto* obj = v.getDynamicObject();
    if (obj == nullptr || !obj->hasProperty(key)) return fallback;
    return (int)obj->getProperty(key);
}

double numProp(const juce::var& v, const char* key, double fallback = 0) {
    const auto* obj = v.getDynamicObject();
    if (obj == nullptr || !obj->hasProperty(key)) return fallback;
    return (double)obj->getProperty(key);
}

/** Read one optional field of a `Partial<PartConfig>`, recording its presence. */
template <typename T, typename Read>
void patchField(const juce::DynamicObject& obj, const char* key, PartField bit, unsigned& mask,
                T& dst, Read read) {
    if (!obj.hasProperty(key)) return;
    dst = read(obj.getProperty(key));
    mask |= (unsigned)bit;
}

unsigned readPartPatch(const juce::var& v, PartConfig& cfg) {
    const auto* obj = v.getDynamicObject();
    if (obj == nullptr) return 0;
    unsigned mask = 0;
    const auto asBool = [](const juce::var& x) { return (bool)x; };
    const auto asInt = [](const juce::var& x) { return (int)x; };
    const auto asNum = [](const juce::var& x) { return (double)x; };

    patchField(*obj, "enabled", PartFieldEnabled, mask, cfg.enabled, asBool);
    patchField(*obj, "rxChannel", PartFieldRxChannel, mask, cfg.rxChannel, asInt);
    patchField(*obj, "volume", PartFieldVolume, mask, cfg.volume, asNum);
    patchField(*obj, "pan", PartFieldPan, mask, cfg.pan, asNum);
    patchField(*obj, "noteLow", PartFieldNoteLow, mask, cfg.noteLow, asInt);
    patchField(*obj, "noteHigh", PartFieldNoteHigh, mask, cfg.noteHigh, asInt);
    patchField(*obj, "noteShift", PartFieldNoteShift, mask, cfg.noteShift, asInt);
    patchField(*obj, "detune", PartFieldDetune, mask, cfg.detune, asInt);
    patchField(*obj, "cutoff", PartFieldCutoff, mask, cfg.cutoff, asNum);
    patchField(*obj, "resonance", PartFieldResonance, mask, cfg.resonance, asNum);
    patchField(*obj, "reverbSend", PartFieldReverbSend, mask, cfg.reverbSend, asNum);
    patchField(*obj, "forcedDamp", PartFieldForcedDamp, mask, cfg.forcedDamp, asBool);
    patchField(*obj, "link", PartFieldLink, mask, cfg.link, asBool);

    if (const auto* voice = obj->getProperty("voice").getDynamicObject()) {
        voice->getProperty("bank").toString().copyToUTF8(cfg.voiceBank, sizeof(cfg.voiceBank));
        cfg.voiceProgram = (int)voice->getProperty("program");
        mask |= (unsigned)PartFieldVoice;
    }
    return mask;
}

/** Pull a `{ "$b64": ... }` field out into `dest`, reusing its capacity. */
bool binaryProp(const juce::var& v, const char* key, std::vector<uint8_t>& dest) {
    const auto* obj = v.getDynamicObject();
    if (obj == nullptr) return false;
    const auto* inner = obj->getProperty(key).getDynamicObject();
    if (inner == nullptr) return false;
    const auto encoded = inner->getProperty("$b64").toString();
    if (encoded.isEmpty()) return false;

    juce::MemoryOutputStream out;
    if (!juce::Base64::convertFromBase64(out, encoded)) return false;
    const auto* bytes = static_cast<const uint8_t*>(out.getData());
    dest.assign(bytes, bytes + out.getDataSize());
    return true;
}

}  // namespace

juce::String toBase64(const uint8_t* data, size_t size) {
    return juce::Base64::toBase64(data, size);
}

std::vector<uint8_t> fromBase64(const juce::String& text) {
    juce::MemoryOutputStream out;
    if (!juce::Base64::convertFromBase64(out, text)) return {};
    const auto* bytes = static_cast<const uint8_t*>(out.getData());
    return {bytes, bytes + out.getDataSize()};
}

juce::var binaryVar(const uint8_t* data, size_t size) {
    auto* obj = new juce::DynamicObject();
    obj->setProperty("$b64", toBase64(data, size));
    return juce::var(obj);
}

namespace {

/** Read one optional global, recording its presence in the mask. */
void globalField(const juce::DynamicObject& obj, const char* key, GlobalParam p, GlobalPatch& out) {
    if (!obj.hasProperty(key)) return;
    out.values[(int)p] = (float)(double)obj.getProperty(key);
    out.mask |= 1u << (int)p;
}

void globalFlag(const juce::DynamicObject& obj, const char* key, GlobalParam p, GlobalPatch& out) {
    if (!obj.hasProperty(key)) return;
    out.values[(int)p] = (bool)obj.getProperty(key) ? 1.0f : 0.0f;
    out.mask |= 1u << (int)p;
}

}  // namespace

bool globalPatchFromJson(const juce::var& json, GlobalPatch& out) {
    const auto* obj = json.getDynamicObject();
    if (obj == nullptr) return false;
    const auto type = obj->getProperty("type").toString();
    out = {};

    if (type == "setAccuracy") {
        out.hasAccuracy = true;
        out.dexedAccuracy = obj->getProperty("accuracy").toString() == "dexed";
        return true;
    }
    if (type != "setGlobal") return false;

    const auto* s = obj->getProperty("settings").getDynamicObject();
    if (s == nullptr) return false;
    globalField(*s, "engine", GlobalParam::Engine, out);
    globalField(*s, "volume", GlobalParam::Volume, out);
    globalField(*s, "polyphony", GlobalParam::Polyphony, out);
    globalField(*s, "masterTuneCents", GlobalParam::MasterTune, out);
    globalFlag(*s, "compressor", GlobalParam::Compressor, out);
    if (s->hasProperty("accuracy")) {
        out.hasAccuracy = true;
        out.dexedAccuracy = s->getProperty("accuracy").toString() == "dexed";
    }
    if (const auto* r = s->getProperty("reverb").getDynamicObject()) {
        globalFlag(*r, "enabled", GlobalParam::ReverbEnabled, out);
        globalField(*r, "size", GlobalParam::ReverbSize, out);
        globalField(*r, "hiDamp", GlobalParam::ReverbHiDamp, out);
        globalField(*r, "loDamp", GlobalParam::ReverbLoDamp, out);
        globalField(*r, "lowpass", GlobalParam::ReverbLowpass, out);
        globalField(*r, "diffusion", GlobalParam::ReverbDiffusion, out);
        globalField(*r, "level", GlobalParam::ReverbLevel, out);
    }
    return out.mask != 0 || out.hasAccuracy;
}

bool gestureFromJson(const juce::var& json, GesturePatch& out) {
    const auto* obj = json.getDynamicObject();
    if (obj == nullptr || obj->getProperty("type").toString() != "paramGesture") return false;

    PartConfig probe;
    const auto field = obj->getProperty("field").toString();
    // Reuse the patch reader so the field names stay in one place: a one-field
    // object yields exactly that field's bit.
    auto* one = new juce::DynamicObject();
    one->setProperty(field, 0);
    const unsigned mask = readPartPatch(juce::var(one), probe);
    if (mask == 0) return false;

    out.part = intProp(json, "index");
    out.param = partFieldParam((PartField)mask);
    out.begin = (bool)obj->getProperty("begin");
    return out.param != PartParam::Count && out.part >= 0 && out.part < kNumParts;
}

bool commandFromJson(const juce::var& json, Command& out, unsigned* partFields) {
    const auto* obj = json.getDynamicObject();
    if (obj == nullptr) return false;
    const auto type = obj->getProperty("type").toString();

    out.type = CommandType::None;
    out.channel = intProp(json, "channel", 1);
    out.hasSupplement = false;
    out.bytes.clear();
    if (partFields != nullptr) *partFields = 0;

    if (type == "noteOn") {
        out.type = CommandType::NoteOn;
        out.a = intProp(json, "note");
        out.b = intProp(json, "velocity");
    } else if (type == "noteOff") {
        out.type = CommandType::NoteOff;
        out.a = intProp(json, "note");
    } else if (type == "cc") {
        out.type = CommandType::Cc;
        out.a = intProp(json, "controller");
        out.b = intProp(json, "value");
    } else if (type == "pitchBend") {
        out.type = CommandType::PitchBend;
        out.a = intProp(json, "value");
    } else if (type == "aftertouch") {
        out.type = CommandType::Aftertouch;
        out.a = intProp(json, "value");
    } else if (type == "panic") {
        out.type = CommandType::Panic;
    } else if (type == "setVolume") {
        out.type = CommandType::SetVolume;
        out.a = intProp(json, "volume");
    } else if (type == "setParam") {
        out.type = CommandType::SetParam;
        out.a = intProp(json, "offset");
        out.b = intProp(json, "value");
    } else if (type == "setSupplementParam") {
        out.type = CommandType::SetSupplementParam;
        out.a = intProp(json, "offset");
        out.b = intProp(json, "value");
    } else if (type == "setEngine") {
        out.type = CommandType::SetEngine;
        out.a = intProp(json, "engine");
    } else if (type == "setAccuracy") {
        out.type = CommandType::SetAccuracy;
        out.a = obj->getProperty("accuracy").toString() == "dexed" ? 1 : 0;
    } else if (type == "setMasterTune") {
        out.type = CommandType::SetMasterTune;
        out.value = numProp(json, "cents");
    } else if (type == "setPolyphonyCap") {
        out.type = CommandType::SetPolyphonyCap;
        out.a = intProp(json, "cap");
    } else if (type == "selectPart") {
        out.type = CommandType::SelectPart;
        out.a = intProp(json, "index");
    } else if (type == "setPart") {
        const unsigned mask = readPartPatch(obj->getProperty("config"), out.config);
        if (mask == 0) return false;
        if (partFields != nullptr) *partFields = mask;
        out.type = CommandType::SetPart;
        out.a = intProp(json, "index");
    } else if (type == "loadVoice") {
        if (!binaryProp(json, "data", out.bytes)) return false;
        // The supplement rides along in the same buffer so a slot load stays one
        // command; the rack splits it back off at offset 156.
        std::vector<uint8_t> supplement;
        if (out.bytes.size() >= 156 && binaryProp(json, "supplement", supplement) &&
            supplement.size() >= 35) {
            out.bytes.insert(out.bytes.end(), supplement.begin(), supplement.begin() + 35);
            out.hasSupplement = true;
        }
        out.type = CommandType::LoadVoice;
        out.a = intProp(json, "partIndex", -1);
    }

    return out.type != CommandType::None;
}

void applyCommand(SynthRack& rack, const Command& cmd) {
    switch (cmd.type) {
        case CommandType::NoteOn: rack.noteOn(cmd.a, cmd.b, cmd.channel); break;
        case CommandType::NoteOff: rack.noteOff(cmd.a, cmd.channel); break;
        case CommandType::Cc: rack.controlChange(cmd.a, cmd.b, cmd.channel); break;
        case CommandType::PitchBend: rack.pitchBend(cmd.a, cmd.channel); break;
        case CommandType::Aftertouch: rack.aftertouch(cmd.a, cmd.channel); break;
        case CommandType::Panic: rack.panic(); break;
        case CommandType::SetVolume: rack.setVolume(cmd.a); break;
        case CommandType::SetEngine: rack.setEngineType((EngineType)cmd.a); break;
        case CommandType::SetAccuracy:
            setEngineAccuracy(cmd.a == 1 ? EngineAccuracy::Dexed : EngineAccuracy::Hardware);
            break;
        case CommandType::SetMasterTune: rack.applyMasterTuneCents(cmd.value); break;
        case CommandType::SetPolyphonyCap: rack.setPolyphonyCap(cmd.a); break;
        case CommandType::SelectPart: rack.selectPart(cmd.a); break;
        case CommandType::SetPart: rack.setPartConfig(cmd.a, cmd.config); break;
        case CommandType::SetParam:
            rack.setVoiceParamForPart(rack.getSelectedPart(), cmd.a, cmd.b);
            break;
        case CommandType::SetSupplementParam:
            rack.setSupplementParamForPart(rack.getSelectedPart(), cmd.a, cmd.b);
            break;
        case CommandType::LoadVoice: {
            if (cmd.bytes.size() < kVoiceSize) break;
            const int part = cmd.a >= 0 ? cmd.a : rack.getSelectedPart();
            rack.loadVoiceForPart(part, cmd.bytes.data(),
                                  cmd.hasSupplement ? cmd.bytes.data() + kVoiceSize : nullptr);
            break;
        }
        case CommandType::None: break;
    }
}

}  // namespace texed
