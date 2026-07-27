#include "env_tables.h"

#include <algorithm>

#include "../msfa/synth.h"

namespace texed {

namespace {

const int levellut[20] = {0,  5,  9,  13, 17, 20, 23, 25, 27, 29,
                          31, 33, 35, 37, 39, 41, 42, 43, 45, 46};

const int32_t statics[77] = {
    1764000, 1764000, 1411200, 1411200, 1190700, 1014300, 992250, 882000, 705600, 705600,
    584325,  507150,  502740,  441000,  418950,  352800,  308700, 286650, 253575, 220500,
    220500,  176400,  145530,  145530,  125685,  110250,  110250, 88200,  88200,  74970,
    61740,   61740,   55125,   48510,   44100,   37485,   31311,  30870,  27562,  27562,
    22050,   18522,   17640,   15435,   14112,   13230,   11025,  9261,   9261,   7717,
    6615,    6615,    5512,    5512,    4410,    3969,    3969,   3439,   2866,   2690,
    2249,    1984,    1896,    1808,    1411,    1367,    1234,   1146,   926,    837,
    837,     705,     573,     573,     529,     441,     441};

/** TABLE_MIDI_VEL: MIDI velocity >> 2 to the DX7's internal (inverted) scale. */
const int midiVelTable[32] = {110, 100, 90, 85, 80, 75, 70, 65, 58, 54, 50, 46, 42, 38, 34, 30,
                              28,  26,  24, 22, 20, 18, 16, 14, 12, 10, 8,  6,  4,  2,  1,  0};

/** TABLE_OP_VOLUME_VELOCITY_SCALE: internal velocity >> 2 to a scaling factor. */
const int opVolumeVelocityScale[32] = {0,   4,   12,  21,  30,  40,  46,  52,  58,  64,  70,
                                       76,  82,  88,  94,  100, 103, 106, 109, 112, 114, 116,
                                       118, 120, 122, 124, 126, 128, 130, 131, 132, 133};

}  // namespace

const int kPitchenvRate[100] = {
    1,   2,   3,   3,   4,   4,   5,   5,   6,   6,   7,   7,   8,   8,   9,   9,   10,
    10,  11,  11,  12,  12,  13,  13,  14,  14,  15,  16,  16,  17,  18,  18,  19,  20,
    21,  22,  23,  24,  25,  26,  27,  28,  30,  31,  33,  34,  36,  37,  38,  39,  41,
    42,  44,  46,  47,  49,  51,  53,  54,  56,  58,  60,  62,  64,  66,  68,  70,  72,
    74,  76,  79,  82,  85,  88,  91,  94,  98,  102, 106, 110, 115, 120, 125, 130, 135,
    141, 147, 153, 159, 165, 171, 178, 185, 193, 202, 211, 232, 243, 254, 255};

const int kPitchenvTab[100] = {
    -128, -116, -104, -95, -85, -76, -68, -61, -56, -52, -49, -46, -43, -41, -39, -37, -35,
    -33,  -32,  -31,  -30, -29, -28, -27, -26, -25, -24, -23, -22, -21, -20, -19, -18, -17,
    -16,  -15,  -14,  -13, -12, -11, -10, -9,  -8,  -7,  -6,  -5,  -4,  -3,  -2,  -1,  0,
    1,    2,    3,    4,   5,   6,   7,   8,   9,   10,  11,  12,  13,  14,  15,  16,  17,
    18,   19,   20,   21,  22,  23,  24,  25,  26,  27,  28,  29,  30,  31,  32,  33,  34,
    35,   38,   40,   43,  46,  49,  53,  58,  65,  73,  82,  92,  103, 115, 127};

const int kKbdScalingCurveExp[36] = {0,   1,   2,   3,   4,   5,   6,   7,   8,   9,   11,  14,
                                     16,  19,  23,  28,  33,  39,  47,  57,  67,  80,  95,  113,
                                     134, 160, 190, 224, 255, 255, 255, 255, 255, 255, 255, 255};

// Index 22 is 178, not the 176 the pattern calls for: a ROM anomaly, kept.
const int kKbdScalingCurveLin[36] = {0,   8,   16,  24,  32,  40,  48,  56,  64,  72,  80,  88,
                                     96,  104, 112, 120, 128, 136, 144, 152, 160, 168, 178, 184,
                                     192, 200, 208, 216, 224, 232, 240, 248, 255, 255, 255, 255};

int scaleoutlevel(int outlevel) {
    return outlevel >= 20 ? 28 + outlevel : levellut[outlevel];
}

int romScaleValue(int v) {
    return (660 * v) >> 8;
}

int kbdScaleCurve(int group, int depth, int curve) {
    const int* table = (curve == 0 || curve == 3) ? kKbdScalingCurveLin : kKbdScalingCurveExp;
    const int raw = table[std::min(group, 35)];
    const int scale = std::min(127, (raw * romScaleValue(depth)) >> 8);
    return curve < 2 ? -scale : scale;
}

int velocityAttenuation(int velocity, int sensitivity) {
    const int clamped = std::min(127, std::max(0, velocity));
    const int internalVel = midiVelTable[clamped >> 2];
    const int velScale = opVolumeVelocityScale[internalVel >> 2];
    const int lo = sensitivity * 32;
    const int hi = ~((sensitivity << 1) | 0xf0) & 0xff;
    return std::min(255, ((lo * velScale) >> 8) + hi);
}

int ampLevelBase(int newlevel) {
    return (scaleoutlevel(newlevel) >> 1) << 6;
}

int32_t ampIncAt(int rate, int32_t srMul, int rateScaling) {
    int qrate = (rate * 41) >> 6;
    qrate += rateScaling;
    if (qrate > 63) qrate = 63;
    return (int32_t)(((int64_t)((4 + (qrate & 3)) << (2 + LG_N + (qrate >> 2))) * srMul) >> 24);
}

int32_t ampStaticAt(int staticrate, int32_t srMul, int shortHold) {
    int32_t sc = staticrate < 77 ? statics[staticrate] : 20 * (99 - staticrate);
    if (staticrate < 77 && shortHold) sc = sc / 20;
    return (int32_t)(((int64_t)sc * srMul) >> 24);
}

int32_t pitchLevelAt(int level) {
    return kPitchenvTab[level] << 19;
}

int32_t pitchIncAt(int rate, int32_t unit) {
    return kPitchenvRate[rate] * unit;
}

}  // namespace texed
