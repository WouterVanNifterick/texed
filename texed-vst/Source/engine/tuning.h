// Tuning: maps a MIDI note to a Q24/octave log-frequency. Port of
// dx7-engine/src/tuning.ts. StandardTuning is 12-TET; MicroTuning applies a
// DX7II micro-tuning table (1/1024-octave per-key offsets).

#pragma once

#include <array>
#include <cstdint>
#include <memory>

namespace texed {

constexpr int kMicroUnitsPerOctave = 1024;

class TuningState {
public:
    virtual ~TuningState() = default;

    void setMasterTuneCents(double cents);
    int32_t midinoteToLogfreq(double midinote) const;
    virtual bool isStandardTuning() const { return masterTuneCents == 0; }

protected:
    /** Untuned Q24 log-frequency for a MIDI note, before the master-tune offset. */
    virtual int32_t untuned(int midinote) const = 0;
    void rebuildTable();

    std::array<int32_t, 128> table{};
    double masterTuneCents = 0;
};

std::shared_ptr<TuningState> createStandardTuning();

/** Build a micro-tuning from decoded per-key units (1/1024 octave). */
std::shared_ptr<TuningState> createMicroTuning(const int32_t units[128]);

}  // namespace texed
