#include "Document.h"

namespace texed {

namespace {

/** Bumped when a field changes meaning, not when one is added. */
constexpr int kVersion = 1;

const juce::Identifier kPartType{"PART"};
const juce::Identifier kVersionProp{"version"};
const juce::Identifier kSelectedProp{"selectedPart"};
const juce::Identifier kAccuracyProp{"dexedAccuracy"};
const juce::Identifier kSnapshotProp{"uiSnapshot"};
const juce::Identifier kProgramsProp{"programNames"};
const juce::Identifier kProgramProp{"currentProgram"};
const juce::Identifier kVoiceProp{"voice"};
const juce::Identifier kSupplementProp{"supplement"};

struct BoolField {
    const char* name;
    bool PartConfig::*field;
};
struct IntField {
    const char* name;
    int PartConfig::*field;
};

// Only the fields the parameters do not own; see partFieldParam.
constexpr BoolField kBools[] = {
    {"enabled", &PartConfig::enabled},
    {"forcedDamp", &PartConfig::forcedDamp},
    {"link", &PartConfig::link},
};
constexpr IntField kInts[] = {
    {"rxChannel", &PartConfig::rxChannel}, {"noteLow", &PartConfig::noteLow},
    {"noteHigh", &PartConfig::noteHigh},   {"noteShift", &PartConfig::noteShift},
    {"voiceProgram", &PartConfig::voiceProgram},
};

void readBytes(const juce::ValueTree& tree, const juce::Identifier& name, uint8_t* dest, size_t size) {
    if (const auto* block = tree.getProperty(name).getBinaryData()) {
        std::copy_n((const uint8_t*)block->getData(), std::min(size, block->getSize()), dest);
    }
}

}  // namespace

const juce::Identifier Document::kType{"TEXEDDOC"};

Document::Document() {
    const auto* init = initVoice();
    for (int i = 0; i < kNumParts; ++i) {
        std::copy_n(init, kVoiceSize, voices[(size_t)i].begin());
        std::copy_n(defaultAmem(), kAmemSlotSize, supplements[(size_t)i].begin());
    }
    configs[0].enabled = true;
}

void Document::readFrom(const juce::ValueTree& tree) {
    if (!tree.hasType(kType)) return;
    carried = tree.createCopy();

    selectedPart = juce::jlimit(0, kNumParts - 1, (int)tree.getProperty(kSelectedProp, 0));
    dexedAccuracy = (bool)tree.getProperty(kAccuracyProp, false);
    uiSnapshot = tree.getProperty(kSnapshotProp, juce::String()).toString();

    const auto names = tree.getProperty(kProgramsProp, juce::String()).toString();
    programNames = names.isEmpty() ? juce::StringArray{} : juce::StringArray::fromLines(names);
    currentProgram = juce::jmax(0, (int)tree.getProperty(kProgramProp, 0));

    for (int i = 0; i < kNumParts && i < tree.getNumChildren(); ++i) {
        const auto part = tree.getChild(i);
        if (!part.hasType(kPartType)) continue;
        readBytes(part, kVoiceProp, voices[(size_t)i].data(), kVoiceSize);
        readBytes(part, kSupplementProp, supplements[(size_t)i].data(), kAmemSlotSize);

        auto& cfg = configs[(size_t)i];
        for (const auto& f : kBools) cfg.*f.field = (bool)part.getProperty(f.name, cfg.*f.field);
        for (const auto& f : kInts) cfg.*f.field = (int)part.getProperty(f.name, cfg.*f.field);
        part.getProperty("voiceBank", juce::String())
            .toString()
            .copyToUTF8(cfg.voiceBank, sizeof(cfg.voiceBank));
    }
}

juce::ValueTree Document::writeTo() const {
    auto tree = carried.isValid() ? carried.createCopy() : juce::ValueTree{kType};
    tree.setProperty(kVersionProp, kVersion, nullptr);
    tree.setProperty(kSelectedProp, selectedPart, nullptr);
    tree.setProperty(kAccuracyProp, dexedAccuracy, nullptr);
    tree.setProperty(kSnapshotProp, uiSnapshot, nullptr);
    tree.setProperty(kProgramsProp, programNames.joinIntoString("\n"), nullptr);
    tree.setProperty(kProgramProp, currentProgram, nullptr);

    while (tree.getNumChildren() < kNumParts) tree.appendChild(juce::ValueTree{kPartType}, nullptr);

    for (int i = 0; i < kNumParts; ++i) {
        auto part = tree.getChild(i);
        part.setProperty(kVoiceProp, juce::var(voices[(size_t)i].data(), kVoiceSize), nullptr);
        part.setProperty(kSupplementProp,
                         juce::var(supplements[(size_t)i].data(), kAmemSlotSize), nullptr);

        const auto& cfg = configs[(size_t)i];
        for (const auto& f : kBools) part.setProperty(f.name, cfg.*f.field, nullptr);
        for (const auto& f : kInts) part.setProperty(f.name, cfg.*f.field, nullptr);
        part.setProperty("voiceBank", juce::String(cfg.voiceBank), nullptr);
    }
    return tree;
}

}  // namespace texed
