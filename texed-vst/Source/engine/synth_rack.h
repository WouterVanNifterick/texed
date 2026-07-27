// Multi-timbral host: up to 8 Parts sharing a global polyphony budget, mixed to
// stereo with per-part volume and pan. Port of the realtime half of
// dx7-engine/src/synth-rack.ts.
//
// The voice library, performances and all SysEx parsing stay in TypeScript; the
// UI resolves a program to bytes and sends those down, so nothing here needs to
// know the file formats.

#pragma once

#include <array>
#include <cstdint>
#include <vector>

#include "compressor.h"
#include "part.h"
#include "part_config.h"
#include "plate_reverb.h"
#include "plugin_fx.h"

namespace texed {

constexpr int kDefaultPolyphony = 32;

/** Port of the ReverbSettings block in dx7-format/src/global-settings.ts. */
struct ReverbSettings {
    bool enabled = false;
    double size = 70 / 99.0;
    double hiDamp = 50 / 99.0;
    double loDamp = 50 / 99.0;
    double lowpass = 30 / 99.0;
    double diffusion = 65 / 99.0;
    double level = 1;
};

struct RackStatus {
    int selectedPart = 0;
    PartStatus part;
    int partActivity[kNumParts]{};
    int totalActive = 0;
};

/** Perceptual volume taper: knob 0..99 to linear master gain 0..1. */
double volumeToGain(int volume);

class SynthRack {
public:
    explicit SynthRack(double sampleRate);

    void setSampleRate(double sampleRate);

    const ReverbSettings& getReverbSettings() const { return reverbSettings; }
    void setReverbSettings(const ReverbSettings& settings);
    void setCompressorEnabled(bool on);
    bool compressorOn() const { return compressorEnabled; }

    void setEngineType(EngineType type);
    EngineType getEngineType() const { return engineType; }

    void setPolyphonyCap(int n);
    int getPolyphonyCap() const { return polyphonyCap; }

    /** Set master volume from the 0..99 knob; the taper yields the gain. */
    void setVolume(int volume);
    int getVolume() const { return volume_; }

    void applyMasterTuneCents(double cents);
    double getMasterTuneCents() const { return masterTuneCents; }
    /** Apply a decoded micro-tuning table, or nullptr for standard tuning. */
    void setMicrotuning(const int32_t units[128]);

    void selectPart(int index);
    int getSelectedPart() const { return selected; }

    const PartConfig& getPartConfig(int index) const { return configs[(size_t)index]; }
    void setPartConfig(int index, const PartConfig& cfg);
    /** Whether a part is enabled and listening on this channel. */
    bool receivesOn(int index, int channel) const { return matches(index, channel); }

    Part& part(int index) { return parts[(size_t)index]; }

    void loadVoiceForPart(int index, const uint8_t* patch, const uint8_t* supplement = nullptr);
    void setVoiceParamForPart(int index, int offset, int value);
    void setSupplementParamForPart(int index, int offset, int value);

    void noteOn(int pitch, int velocity, int channel = 1);
    void noteOff(int pitch, int channel = 1);
    /** Returns a bitmask of the parts whose config the CC changed. */
    unsigned controlChange(int ctrl, int value, int channel = 1);
    void pitchBend(int value14, int channel = 1);
    void aftertouch(int value, int channel = 1);
    void panic();

    const RackStatus& getStatus();

    void render(float* outL, float* outR, int numSamples);

private:
    bool isSlave(int index) const;
    int masterIndexOf(int index) const;
    int groupEnd(int master) const;
    void syncLinkedSlaves(int master);
    bool matches(int index, int channel) const;
    int totalActiveVoices() const;
    void enforceCap(int needed);
    CcRouting rackControlChange(int index, int ctrl, int value);
    void ensureBuffers(int numSamples);

    std::array<Part, kNumParts> parts;
    std::array<PartConfig, kNumParts> configs;
    /** Per-part gain ramp and ladder filter; DC is handled once on the master. */
    std::array<PluginFx, kNumParts> partFx;
    std::array<Compressor, kNumParts> compressors;
    PluginFx fxL, fxR;
    PlateReverb reverb;
    ReverbSettings reverbSettings;
    bool compressorEnabled = false;

    /** Receive channel to restore when CC 124 turns omni back off. */
    int preOmniChannel[kNumParts];

    int polyphonyCap = kDefaultPolyphony;
    EngineType engineType = EngineType::MarkI;
    int volume_ = 80;
    double masterGain = 0;
    int selected = 0;
    double masterTuneCents = 0;

    std::vector<float> scratch;
    /** Reverb send bus and its wet return; grown with `scratch`. */
    std::vector<float> sendL, sendR, wetL, wetR;
    RackStatus status;
};

}  // namespace texed
