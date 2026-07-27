// The persisted state a host cannot automate: the voices, the part fields the
// parameters do not own, and the UI's own library snapshot.
//
// Kept as plain data with a ValueTree on either side of it, so restoring works
// with no editor open and no format code in the plugin. The tree a session was
// saved with is held on to, which is what lets properties written by a newer
// version survive a round-trip through an older one.

#pragma once

#include <array>
#include <juce_data_structures/juce_data_structures.h>

#include "engine/amem.h"
#include "engine/part_config.h"
#include "engine/voice.h"

namespace texed {

class Document {
public:
    Document();

    std::array<std::array<uint8_t, kVoiceSize>, kNumParts> voices{};
    std::array<std::array<uint8_t, kAmemSlotSize>, kNumParts> supplements{};
    /**
     * Only the fields `partFieldParam` does not map to a parameter are read
     * back; the rest are filled from the APVTS when the config is handed out.
     */
    std::array<PartConfig, kNumParts> configs{};
    int selectedPart = 0;
    /**
     * The performances the UI last published, which the host sees as programs.
     * Persisted so the names are there before the editor has ever opened.
     */
    juce::StringArray programNames;
    int currentProgram = 0;
    /** Level curve and rate calibration; 'dexed' keeps the stock msfa numbers. */
    bool dexedAccuracy = false;
    /** Opaque RackState JSON from the UI: banks, performances, tunings. */
    juce::String uiSnapshot;

    void readFrom(const juce::ValueTree& tree);
    juce::ValueTree writeTo() const;

    static const juce::Identifier kType;

private:
    /** The tree last read, so unknown properties are written back out. */
    juce::ValueTree carried;
};

}  // namespace texed
