#include "lfo.h"

#include <cmath>

#include "../msfa/sin.h"
#include "../msfa/synth.h"
#include "engine_accuracy.h"

namespace texed {

namespace {

const double lfoSource[100] = {
    0.062541, 0.125031, 0.312393, 0.437120, 0.624610, 0.750694, 0.936330, 1.125302, 1.249609,
    1.436782, 1.560915, 1.752081, 1.875117, 2.062494, 2.247191, 2.374451, 2.560492, 2.686728,
    2.873976, 2.998950, 3.188013, 3.369840, 3.500175, 3.682224, 3.812065, 4.000800, 4.186202,
    4.310716, 4.501260, 4.623209, 4.814636, 4.930480, 5.121901, 5.315191, 5.434783, 5.617346,
    5.750431, 5.946717, 6.062811, 6.248438, 6.431695, 6.564264, 6.749460, 6.868132, 7.052186,
    7.250580, 7.375719, 7.556294, 7.687577, 7.877738, 7.993605, 8.181967, 8.372405, 8.504848,
    8.685079, 8.810573, 8.986341, 9.122423, 9.300595, 9.500285, 9.607994, 9.798158, 9.950249,
    10.117361, 11.251125, 11.384335, 12.562814, 13.676149, 13.904338, 15.092062, 16.366612,
    16.638935, 17.869907, 19.193858, 19.425019, 20.833333, 21.034918, 22.502250, 24.003841,
    24.260068, 25.746653, 27.173913, 27.578599, 29.052876, 30.693677, 31.191516, 32.658393,
    34.317090, 34.674064, 36.416606, 38.197097, 38.550501, 40.387722, 40.749796, 42.625746,
    44.326241, 44.883303, 46.772685, 48.590865, 49.261084};

uint32_t unit = 0;
double lforatio = 0.0;

}  // namespace

uint32_t romLfoIncrement(int speed) {
    const uint32_t a = speed == 0 ? 1u : (uint32_t)((165 * speed) >> 6);
    return a * (a < 160 ? 11u : 11u + ((a - 160) >> 2));
}

void Lfo::init(double sampleRate) {
    // Both the LFO phase and the LFO delay live in 16-bit accumulators clocked
    // once per output-compare interrupt, so one constant converts both to our
    // 32-bit per-block domain. msfa's 25190424 puts the tick ~2.5% fast.
    unit = isHardwareAccurate()
               ? (uint32_t)std::floor((N * 65536.0 * kOcfTickHz) / sampleRate + 0.5)
               : (uint32_t)std::floor((N * 25190424.0) / sampleRate + 0.5);
    lforatio = std::trunc((4437500000.0 * N) / sampleRate);
}

void Lfo::reset(const uint8_t* params) {
    const int rate = params[0];  // 0..99
    delta = isHardwareAccurate()
                ? unit * romLfoIncrement(rate)
                : (uint32_t)(int64_t)std::trunc(lfoSource[rate] * lforatio);

    uint32_t a = 99u - params[1];  // LFO delay
    if (a == 99) {
        delayinc = 0xffffffffu;
        delayinc2 = 0xffffffffu;
    } else {
        a = (16 + (a & 15)) << (1 + (a >> 4));
        delayinc = unit * a;
        a &= 0xff80;
        a = a > 0x80 ? a : 0x80;
        delayinc2 = unit * a;
    }
    waveform = params[5];
    sync = params[4] != 0;
}

int32_t Lfo::getsample() {
    const uint32_t prevPhase = phase;
    phase += delta;
    uint32_t x;
    switch (waveform) {
        case 0:  // triangle
            x = phase >> 7;
            x ^= 0u - (phase >> 31);
            x &= (1 << 24) - 1;
            return (int32_t)x;
        case 1:  // sawtooth down
            return (int32_t)((~phase ^ 0x80000000u) >> 8);
        case 2:  // sawtooth up
            return (int32_t)((phase ^ 0x80000000u) >> 8);
        case 3:  // square
            return (int32_t)((~phase >> 7) & (1u << 24));
        case 4:  // sine
            return (1 << 23) + (Sin::lookup((int32_t)(phase >> 8)) >> 1);
        case 5:
            // LFO_GET_AMPLITUDE branches on the signed overflow flag after adding
            // the increment to the 16-bit phase, so the hold re-samples when the
            // phase crosses the halfway point, not when it wraps through zero.
            if ((prevPhase >> 31) == 0 && (phase >> 31) == 1) {
                randstate = (randstate * 179 + 17) & 0xff;
            }
            x = randstate ^ 0x80;
            return (int32_t)((x + 1) << 16);
        default: break;
    }
    return 1 << 23;
}

int32_t Lfo::getdelay() {
    const uint32_t inc = delaystate < 0x80000000u ? delayinc : delayinc2;
    const uint64_t d = (uint64_t)delaystate + inc;
    if (d > 0xffffffffull) return 1 << 24;
    delaystate = (uint32_t)d;
    if (delaystate < 0x80000000u) return 0;
    return (int32_t)((delaystate >> 7) & ((1 << 24) - 1));
}

void Lfo::keydown() {
    if (sync) phase = 0x7fffffffu;
    delaystate = 0;
}

}  // namespace texed
