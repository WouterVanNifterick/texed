// The automatable half of the plugin's state: the APVTS layout and typed
// access to it.
//
// Rule for the whole plugin: a value lives either here or in the Document,
// never both. `partFieldParam` in ParamIds.h is what the two sides agree on.

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "ParamIds.h"

namespace texed {

class SynthRack;

juce::String parameterId(GlobalParam p);
juce::String parameterId(int part, PartParam p);

juce::AudioProcessorValueTreeState::ParameterLayout parameterLayout();

/**
 * Typed access to the APVTS: an atomic per parameter for the audio thread, and
 * the parameter object itself for message-thread writes the host records.
 * Values are always in the parameter's own units, never normalised.
 */
class Parameters {
public:
    void attach(juce::AudioProcessorValueTreeState& apvts);

    float get(GlobalParam p) const { return globalValues[(int)p]->load(std::memory_order_relaxed); }
    float get(int part, PartParam p) const {
        return partValues[part][(int)p]->load(std::memory_order_relaxed);
    }

    /** Message thread only. */
    void set(GlobalParam p, float value) { write(globals[(int)p], value); }
    void set(int part, PartParam p, float value) { write(parts[part][(int)p], value); }
    void gesture(int part, PartParam p, bool begin) { bracket(parts[part][(int)p], begin); }

    /** Fill the fields of `cfg` that this owns. */
    void readInto(int part, PartConfig& cfg) const;

    /** Adopt the supplement-backed values of a freshly loaded AMEM slot. */
    void adoptSupplement(int part, const uint8_t* amem);

private:
    static void write(juce::RangedAudioParameter* p, float value);
    static void bracket(juce::RangedAudioParameter* p, bool begin);

    juce::RangedAudioParameter* globals[kNumGlobalParams]{};
    juce::RangedAudioParameter* parts[kNumParts][kNumPartParams]{};
    std::atomic<float>* globalValues[kNumGlobalParams]{};
    std::atomic<float>* partValues[kNumParts][kNumPartParams]{};
};

/**
 * Last values pushed into the rack, so a block only does the work a changed
 * parameter actually needs. Audio thread only.
 */
struct ParameterCache {
    float globals[kNumGlobalParams];
    float parts[kNumParts][kNumPartParams];

    ParameterCache();
};

/** Audio thread: bring the rack in line with the parameters. */
void applyParameters(const Parameters& params, SynthRack& rack, ParameterCache& cache);

}  // namespace texed
