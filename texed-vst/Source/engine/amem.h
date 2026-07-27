// DX7II additional voice memory (AMEM): the 35-byte per-voice supplement.
// Port of the parsing half of dx7-format/src/amem.ts; the SysEx packing stays
// in TypeScript, since only the parsed values reach the engine.

#pragma once

#include <array>
#include <cstdint>

namespace texed {

constexpr int kAmemSlotSize = 35;

/** DX7II modulation ranges for one physical controller (all 0-99). */
struct CtrlRanges {
    int pitch = 0;
    int amp = 0;
    int eg = 0;
    /** FC1/FC2/MIDI-ctrl only: volume attenuation range. */
    int vol = 0;
    /** BC/AT only: pitch bias, stored 0-99 with 50 = no bias. */
    int pitchBias = 50;
};

/** Per-voice DX7II supplement parameters parsed from a 35-byte AMEM slot. */
class VoiceSupplement {
public:
    VoiceSupplement();
    explicit VoiceSupplement(const uint8_t* amem);

    const std::array<uint8_t, kAmemSlotSize>& rawBytes() const { return raw; }

    /** Extended AMS sensitivity table index 0-7 for the ampmodsens lookup. */
    int amsIndex(int op) const;

    std::array<uint8_t, kAmemSlotSize> raw{};
    /** AMS 0-7 per operator (index 0 = OP6 ... 5 = OP1). */
    int ams[6]{};
    /** Random pitch fluctuation depth 0-7 (0 = off ... 7 is about +/-41 cents). */
    int randomPitchDepth = 0;
    bool pitchEgVelSens = false;
    /** LFO key trigger: false = single (one per part), true = retrigger per note. */
    bool lfoKeyTrigger = false;
    int pitchEgRange = 0;
    bool mono = false;
    bool unison = false;
    int pitchBendRange = 0;
    int pitchBendStep = 0;
    int pitchBendMode = 0;
    int portamentoMode = 0;
    /** Portamento step 0-12: 0 = smooth, n = glissando quantized to n semitones. */
    int portamentoStep = 0;
    int portamentoTime = 0;
    int pitchEgScaleRate = 0;
    int unisonDetune = 0;
    /** FC1 doubles as CS1 (front-panel slider); its mod routings are bypassed. */
    bool fc1AsCs1 = false;

    CtrlRanges wheel, foot, breath, at, foot2, midiCtrl;
};

/** Default AMEM: LTRG set, so a plain DX7 voice retriggers the LFO per note-on. */
const uint8_t* defaultAmem();

// DX7II AMS 0-7 is higher resolution over the same depth range as DX7 AMS 0-3.
extern const int32_t kExtendedAmsTable[8];

}  // namespace texed
