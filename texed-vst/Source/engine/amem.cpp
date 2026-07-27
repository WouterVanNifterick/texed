#include "amem.h"

#include <algorithm>

namespace texed {

namespace {

const uint8_t kDefaultAmemBytes[kAmemSlotSize] = {
    0x00, 0x00, 0x00, 0x00, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00};

CtrlRanges ctrlRanges(const uint8_t* a, int off, bool hasVol, bool hasBias) {
    CtrlRanges r;
    r.pitch = a[off] & 0x7f;
    r.amp = a[off + 1] & 0x7f;
    r.eg = a[off + 2] & 0x7f;
    r.vol = hasVol ? a[off + 3] & 0x7f : 0;
    r.pitchBias = hasBias ? a[off + 3] & 0x7f : 50;
    return r;
}

}  // namespace

const int32_t kExtendedAmsTable[8] = {
    0,          //  0
    2171169,    //  1 (~depth 33)
    4342338,    //  2 (= DX7 AMS 1)
    5263440,    //  3 (~depth 80)
    6250335,    //  4 (~depth 95)
    7171437,    //  5 (= DX7 AMS 2)
    11974327,   //  6 (~depth 182)
    16777216};  //  7 (= DX7 AMS 3)

const uint8_t* defaultAmem() {
    return kDefaultAmemBytes;
}

VoiceSupplement::VoiceSupplement() : VoiceSupplement(kDefaultAmemBytes) {}

VoiceSupplement::VoiceSupplement(const uint8_t* a) {
    std::copy(a, a + kAmemSlotSize, raw.begin());

    ams[0] = a[1] & 0x07;
    ams[1] = (a[1] >> 3) & 0x07;
    ams[2] = a[2] & 0x07;
    ams[3] = (a[2] >> 3) & 0x07;
    ams[4] = a[3] & 0x07;
    ams[5] = (a[3] >> 3) & 0x07;

    randomPitchDepth = (a[4] >> 4) & 0x07;
    pitchEgVelSens = (a[4] & 0x08) != 0;
    lfoKeyTrigger = (a[4] & 0x04) != 0;
    pitchEgRange = a[4] & 0x03;
    mono = (a[5] & 0x01) != 0;
    unison = (a[5] & 0x02) != 0;
    pitchBendRange = (a[5] >> 2) & 0x0f;
    pitchBendStep = a[6] & 0x0f;
    pitchBendMode = (a[6] >> 4) & 0x03;
    portamentoMode = a[7] & 0x01;
    portamentoStep = (a[7] >> 1) & 0x0f;
    portamentoTime = a[8] & 0x7f;
    wheel = ctrlRanges(a, 9, false, false);
    foot = ctrlRanges(a, 12, true, false);
    breath = ctrlRanges(a, 16, false, true);
    at = ctrlRanges(a, 20, false, true);
    pitchEgScaleRate = a[24] & 0x07;
    foot2 = ctrlRanges(a, 26, true, false);
    midiCtrl = ctrlRanges(a, 30, true, false);
    unisonDetune = a[34] & 0x07;
    fc1AsCs1 = (a[34] & 0x08) != 0;
}

int VoiceSupplement::amsIndex(int op) const {
    return std::min(7, std::max(0, ams[op]));
}

}  // namespace texed
