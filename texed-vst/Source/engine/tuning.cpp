#include "tuning.h"

#include <algorithm>
#include <cmath>

namespace texed {

namespace {

constexpr int32_t kBase = 50857777;
constexpr int32_t kOctaveQ24 = 1 << 24;
constexpr int32_t kSemitoneQ24 = kOctaveQ24 / 12;
constexpr int32_t kMicroUnitQ24 = kOctaveQ24 / kMicroUnitsPerOctave;

class StandardTuning : public TuningState {
public:
    StandardTuning() { rebuildTable(); }

protected:
    int32_t untuned(int mn) const override { return kBase + kSemitoneQ24 * mn; }
};

class MicroTuning : public TuningState {
public:
    explicit MicroTuning(const int32_t u[128]) {
        std::copy(u, u + 128, units.begin());
        rebuildTable();
    }

    bool isStandardTuning() const override { return false; }

protected:
    int32_t untuned(int mn) const override { return kBase + units[(size_t)mn] * kMicroUnitQ24; }

private:
    std::array<int32_t, 128> units{};
};

}  // namespace

void TuningState::rebuildTable() {
    const int32_t tuneOffset = (int32_t)std::trunc((masterTuneCents / 100.0) * kSemitoneQ24);
    for (int mn = 0; mn < 128; mn++) {
        table[(size_t)mn] = untuned(mn) + tuneOffset;
    }
}

void TuningState::setMasterTuneCents(double cents) {
    masterTuneCents = cents;
    rebuildTable();
}

int32_t TuningState::midinoteToLogfreq(double midinote) const {
    const double clamped = std::max(0.0, std::min(127.0, midinote));
    const int lo = (int)std::floor(clamped);
    const int hi = std::min(127, lo + 1);
    const double frac = clamped - lo;
    if (frac == 0) return table[(size_t)lo];
    return (int32_t)std::trunc(table[(size_t)lo] * (1 - frac) + table[(size_t)hi] * frac);
}

std::shared_ptr<TuningState> createStandardTuning() {
    return std::make_shared<StandardTuning>();
}

std::shared_ptr<TuningState> createMicroTuning(const int32_t units[128]) {
    return std::make_shared<MicroTuning>(units);
}

}  // namespace texed
