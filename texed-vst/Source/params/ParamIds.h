// Which automatable value is which, and the table that says whether a
// PartConfig field belongs to the parameters or to the document.
//
// Free of JUCE so the bridge and the headless renderer can share it; the APVTS
// itself lives in Parameters.h.

#pragma once

#include "../engine/part_config.h"

namespace texed {

enum class GlobalParam {
    Volume,
    Engine,
    Polyphony,
    MasterTune,
    Compressor,
    ReverbEnabled,
    ReverbSize,
    ReverbHiDamp,
    ReverbLoDamp,
    ReverbLowpass,
    ReverbDiffusion,
    ReverbLevel,
    Count,
};

/**
 * Per-part automatable values. The last seven are backed by AMEM bytes: the
 * parameter is the owner and the supplement byte follows it, except when a
 * voice is loaded, which pushes its own values into the parameters first.
 *
 * The four controller entries are the *pitch* modulation range. Amplitude and
 * EG bias ranges stay with the voice: one knob cannot own three values without
 * flattening them on the next voice load.
 */
enum class PartParam {
    Volume,
    Pan,
    Detune,
    Cutoff,
    Resonance,
    ReverbSend,
    Mono,
    PortamentoTime,
    PitchBendRange,
    WheelRange,
    FootRange,
    BreathRange,
    AftertouchRange,
    Count,
};

constexpr int kNumGlobalParams = (int)GlobalParam::Count;
constexpr int kNumPartParams = (int)PartParam::Count;

/** The parameter a PartConfig field belongs to, or Count when the document owns it. */
PartParam partFieldParam(PartField field);
/** That field's value out of `cfg`, on the parameter's scale. */
float partFieldValue(const PartConfig& cfg, PartField field);

}  // namespace texed
