#include "Parameters.h"

#include <limits>

#include "../engine/synth_rack.h"

namespace texed {

namespace {

struct GlobalSpec {
    const char* id;
    const char* name;
};

const GlobalSpec kGlobals[kNumGlobalParams] = {
    {"volume", "Master Volume"},        {"engine", "Engine"},
    {"polyphony", "Polyphony"},         {"masterTune", "Master Tune"},
    {"compressor", "Compressor"},       {"reverb", "Reverb"},
    {"reverbSize", "Reverb Size"},      {"reverbHiDamp", "Reverb HF Damping"},
    {"reverbLoDamp", "Reverb LF Damping"}, {"reverbLowpass", "Reverb Low Pass"},
    {"reverbDiffusion", "Reverb Diffusion"}, {"reverbLevel", "Reverb Level"},
};

struct PartSpec {
    const char* id;
    const char* name;
    float min, max, def;
    /** Integer-valued parameters step; the rest are continuous. */
    bool discrete;
};

const PartSpec kPartSpecs[kNumPartParams] = {
    {"volume", "Volume", 0, 1, 1, false},
    {"pan", "Pan", -1, 1, 0, false},
    {"detune", "Detune", -7, 7, 0, true},
    {"cutoff", "Cutoff", 0, 1, 1, false},
    {"resonance", "Resonance", 0, 1, 0, false},
    {"reverbSend", "Reverb Send", 0, 1, 0, false},
    {"mono", "Mono", 0, 1, 0, true},
    {"portamentoTime", "Portamento Time", 0, 99, 0, true},
    {"pitchBendRange", "Pitch Bend Range", 0, 12, 2, true},
    {"wheelRange", "Mod Wheel Pitch Range", 0, 99, 0, true},
    {"footRange", "Foot Pitch Range", 0, 99, 0, true},
    {"breathRange", "Breath Pitch Range", 0, 99, 0, true},
    {"aftertouchRange", "Aftertouch Pitch Range", 0, 99, 0, true},
};

/** AMEM byte each supplement-backed parameter writes into. */
constexpr int kSupplementByte[kNumPartParams] = {-1, -1, -1, -1, -1, -1, 5, 8, 5, 9, 12, 16, 20};

std::unique_ptr<juce::RangedAudioParameter> makeFloat(const juce::String& id,
                                                      const juce::String& name, float min, float max,
                                                      float def) {
    return std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{id, 1}, name,
                                                       juce::NormalisableRange<float>{min, max}, def);
}

std::unique_ptr<juce::RangedAudioParameter> makeInt(const juce::String& id, const juce::String& name,
                                                    int min, int max, int def) {
    return std::make_unique<juce::AudioParameterInt>(juce::ParameterID{id, 1}, name, min, max, def);
}

}  // namespace

juce::String parameterId(GlobalParam p) {
    return kGlobals[(int)p].id;
}

juce::String parameterId(int part, PartParam p) {
    return "p" + juce::String(part + 1) + "." + kPartSpecs[(int)p].id;
}

juce::AudioProcessorValueTreeState::ParameterLayout parameterLayout() {
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    const auto gid = [](GlobalParam p) { return parameterId(p); };
    const auto gname = [](GlobalParam p) { return juce::String(kGlobals[(int)p].name); };

    layout.add(makeInt(gid(GlobalParam::Volume), gname(GlobalParam::Volume), 0, 99, 80));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{gid(GlobalParam::Engine), 1}, gname(GlobalParam::Engine),
        juce::StringArray{"Modern", "Mark I", "OPL"}, (int)EngineType::MarkI));
    layout.add(makeInt(gid(GlobalParam::Polyphony), gname(GlobalParam::Polyphony), 1, 64,
                       kDefaultPolyphony));
    layout.add(makeFloat(gid(GlobalParam::MasterTune), gname(GlobalParam::MasterTune), -150, 150, 0));
    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID{gid(GlobalParam::Compressor), 1}, gname(GlobalParam::Compressor), false));
    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID{gid(GlobalParam::ReverbEnabled), 1}, gname(GlobalParam::ReverbEnabled),
        false));

    // Reverb defaults are MiniDexed's, expressed on the 0..1 the DSP takes.
    const float reverbDefaults[] = {70 / 99.0f, 50 / 99.0f, 50 / 99.0f, 30 / 99.0f, 65 / 99.0f, 1.0f};
    for (int i = 0; i < 6; ++i) {
        const auto p = (GlobalParam)((int)GlobalParam::ReverbSize + i);
        layout.add(makeFloat(gid(p), gname(p), 0, 1, reverbDefaults[i]));
    }

    for (int part = 0; part < kNumParts; ++part) {
        for (int i = 0; i < kNumPartParams; ++i) {
            const auto& spec = kPartSpecs[i];
            const auto id = parameterId(part, (PartParam)i);
            const auto name = "Part " + juce::String(part + 1) + " " + spec.name;
            if (spec.discrete) {
                layout.add(makeInt(id, name, (int)spec.min, (int)spec.max, (int)spec.def));
            } else {
                layout.add(makeFloat(id, name, spec.min, spec.max, spec.def));
            }
        }
    }
    return layout;
}

void Parameters::attach(juce::AudioProcessorValueTreeState& apvts) {
    for (int i = 0; i < kNumGlobalParams; ++i) {
        const auto id = parameterId((GlobalParam)i);
        globals[i] = apvts.getParameter(id);
        globalValues[i] = apvts.getRawParameterValue(id);
    }
    for (int part = 0; part < kNumParts; ++part) {
        for (int i = 0; i < kNumPartParams; ++i) {
            const auto id = parameterId(part, (PartParam)i);
            parts[part][i] = apvts.getParameter(id);
            partValues[part][i] = apvts.getRawParameterValue(id);
        }
    }
}

void Parameters::write(juce::RangedAudioParameter* p, float value) {
    p->setValueNotifyingHost(p->convertTo0to1(value));
}

void Parameters::bracket(juce::RangedAudioParameter* p, bool begin) {
    if (begin) {
        p->beginChangeGesture();
    } else {
        p->endChangeGesture();
    }
}

void Parameters::readInto(int part, PartConfig& cfg) const {
    cfg.volume = get(part, PartParam::Volume);
    cfg.pan = get(part, PartParam::Pan);
    cfg.detune = (int)get(part, PartParam::Detune);
    cfg.cutoff = get(part, PartParam::Cutoff);
    cfg.resonance = get(part, PartParam::Resonance);
    cfg.reverbSend = get(part, PartParam::ReverbSend);
}

void Parameters::adoptSupplement(int part, const uint8_t* amem) {
    set(part, PartParam::Mono, (float)(amem[5] & 0x01));
    set(part, PartParam::PitchBendRange, (float)((amem[5] >> 2) & 0x0f));
    set(part, PartParam::PortamentoTime, (float)(amem[8] & 0x7f));
    for (int i = 0; i < 4; ++i) {
        const auto p = (PartParam)((int)PartParam::WheelRange + i);
        set(part, p, (float)(amem[kSupplementByte[(int)p]] & 0x7f));
    }
}

ParameterCache::ParameterCache() {
    // NaN so the first block pushes everything, whatever the parameters hold.
    const float unset = std::numeric_limits<float>::quiet_NaN();
    for (auto& v : globals) v = unset;
    for (auto& part : parts) {
        for (auto& v : part) v = unset;
    }
}

namespace {

/** True when the value moved; NaN in the cache always counts as a move. */
bool changed(float& cached, float value) {
    if (cached == value) return false;
    cached = value;
    return true;
}

/** Rewrite the AMEM bytes the parameters own, re-parsing only what moved. */
void applySupplement(Part& part, const Parameters& params, int index, float* cache) {
    const float mono = params.get(index, PartParam::Mono);
    const float bend = params.get(index, PartParam::PitchBendRange);
    const bool monoMoved = changed(cache[(int)PartParam::Mono], mono);
    const bool bendMoved = changed(cache[(int)PartParam::PitchBendRange], bend);
    if (monoMoved || bendMoved) {
        // Byte 5 also carries the unison bit, which stays with the voice.
        const int unison = part.getSupplementData()[5] & 0x02;
        part.setSupplementParam(5, unison | (int)mono | ((int)bend << 2));
    }

    for (int i = (int)PartParam::PortamentoTime; i <= (int)PartParam::AftertouchRange; ++i) {
        if (i == (int)PartParam::PitchBendRange) continue;
        const float value = params.get(index, (PartParam)i);
        if (changed(cache[i], value)) part.setSupplementParam(kSupplementByte[i], (int)value);
    }
}

}  // namespace

void applyParameters(const Parameters& params, SynthRack& rack, ParameterCache& cache) {
    if (changed(cache.globals[(int)GlobalParam::Volume], params.get(GlobalParam::Volume))) {
        rack.setVolume((int)params.get(GlobalParam::Volume));
    }
    if (changed(cache.globals[(int)GlobalParam::Engine], params.get(GlobalParam::Engine))) {
        rack.setEngineType((EngineType)(int)params.get(GlobalParam::Engine));
    }
    if (changed(cache.globals[(int)GlobalParam::Polyphony], params.get(GlobalParam::Polyphony))) {
        rack.setPolyphonyCap((int)params.get(GlobalParam::Polyphony));
    }
    if (changed(cache.globals[(int)GlobalParam::MasterTune], params.get(GlobalParam::MasterTune))) {
        rack.applyMasterTuneCents(params.get(GlobalParam::MasterTune));
    }
    if (changed(cache.globals[(int)GlobalParam::Compressor],
                params.get(GlobalParam::Compressor))) {
        rack.setCompressorEnabled(params.get(GlobalParam::Compressor) >= 0.5f);
    }

    bool reverbMoved = false;
    for (int i = (int)GlobalParam::ReverbEnabled; i <= (int)GlobalParam::ReverbLevel; ++i) {
        reverbMoved |= changed(cache.globals[i], params.get((GlobalParam)i));
    }
    if (reverbMoved) {
        ReverbSettings r;
        r.enabled = params.get(GlobalParam::ReverbEnabled) >= 0.5f;
        r.size = params.get(GlobalParam::ReverbSize);
        r.hiDamp = params.get(GlobalParam::ReverbHiDamp);
        r.loDamp = params.get(GlobalParam::ReverbLoDamp);
        r.lowpass = params.get(GlobalParam::ReverbLowpass);
        r.diffusion = params.get(GlobalParam::ReverbDiffusion);
        r.level = params.get(GlobalParam::ReverbLevel);
        rack.setReverbSettings(r);
    }

    for (int i = 0; i < kNumParts; ++i) {
        bool mix = false;
        for (int p = 0; p <= (int)PartParam::ReverbSend; ++p) {
            mix |= changed(cache.parts[i][p], params.get(i, (PartParam)p));
        }
        if (mix) {
            PartConfig cfg = rack.getPartConfig(i);
            params.readInto(i, cfg);
            rack.setPartConfig(i, cfg);
        }
        applySupplement(rack.part(i), params, i, cache.parts[i]);
    }
}

}  // namespace texed
