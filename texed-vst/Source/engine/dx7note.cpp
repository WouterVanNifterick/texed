#include "dx7note.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <random>

#include "../msfa/exp2.h"
#include "../msfa/fm_core.h"
#include "../msfa/freqlut.h"
#include "../msfa/synth.h"
#include "engine_accuracy.h"
#include "env_tables.h"
#include "porta.h"

namespace texed {

namespace {

constexpr int kFeedbackBitdepth = 8;

const int32_t coarsemul[32] = {
    -16777216, 0,        16777216, 26591258, 33554432, 38955489, 43368474, 47099600,
    50331648,  53182516, 55732705, 58039632, 60145690, 62083076, 63876816, 65546747,
    67108864,  68576247, 69959732, 71268397, 72509921, 73690858, 74816848, 75892776,
    76922906,  77910978, 78860292, 79773775, 80654032, 81503396, 82323963, 83117622};

/** Random pitch fluctuation depth 0-7 to max deviation in cents. */
const int randomPitchCents[8] = {0, 5, 11, 17, 23, 29, 35, 41};

const int velocityData[64] = {0,   70,  86,  97,  106, 114, 121, 126, 132, 138, 142, 148, 152,
                              156, 160, 163, 166, 170, 173, 174, 178, 181, 184, 186, 189, 190,
                              194, 196, 198, 200, 202, 205, 206, 209, 211, 214, 216, 218, 220,
                              222, 224, 225, 227, 229, 230, 232, 233, 235, 237, 238, 240, 241,
                              242, 243, 244, 246, 246, 248, 249, 250, 251, 252, 253, 254};

const int expScaleData[33] = {0,  1,  2,  3,  4,  5,   6,   7,   8,   9,   11,  14,  16,
                              19, 23, 27, 33, 39, 47,  56,  66,  80,  94,  110, 126, 142,
                              158, 174, 190, 206, 222, 238, 250};

const int pitchmodsenstab[8] = {0, 10, 20, 33, 55, 92, 153, 255};

// DX7II pitch EG range (AMEM): 8va (full DX7 range), 2va, 1va, half-va, as a
// right shift of the Q24 pitch EG output.
const int pegRangeShift[4] = {0, 2, 3, 4};

// The EGS operator-level register is an 8-bit attenuation the ROM clamps to
// 4..255 - a DX7 never runs an operator at absolute full output. In our units
// `outlevel = 4304 - 16 * attenuation`.
constexpr int kOutlevelMax = 4240;
constexpr int kOutlevelMin = 224;

int clampInt(int v, int lo, int hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/** Arithmetic right shift of a 64-bit value, matching the TypeScript sar64. */
inline int64_t sar64(int64_t value, int shift) {
    return value >> shift;
}

int scaleCurve(int group, int depth, int curve) {
    if (isHardwareAccurate()) return kbdScaleCurve(group, depth, curve);
    int scale;
    if (curve == 0 || curve == 3) {
        scale = (group * depth * 329) >> 12;
    } else {
        const int rawExp = expScaleData[std::min(group, 32)];
        scale = (rawExp * depth * 329) >> 15;
    }
    if (curve < 2) scale = -scale;
    return scale;
}

/** Per-note pitch jitter. Only reached when a voice asks for it (RNDP > 0). */
double nextRandomUnit() {
    static std::mt19937 rng{0x7e8ed};
    static std::uniform_real_distribution<double> dist(-1.0, 1.0);
    return dist(rng);
}

}  // namespace

int32_t logfreqRoundSemi(int32_t freq, int semis) {
    constexpr int32_t base = 50857777;
    const int32_t step = (int32_t)(((1 << 24) / 12.0) * semis);
    if (step <= 0) return freq;
    const int32_t rem = (((freq - base) % step) + step) % step;
    return freq - rem;
}

int scaleVelocity(int velocity, int sensitivity) {
    if (isHardwareAccurate()) {
        // One attenuation LSB is 16 of our level units, hence the << 4.
        return (15 - velocityAttenuation(velocity, sensitivity)) << 4;
    }
    const int clampedVel = clampInt(velocity, 0, 127);
    const int velValue = velocityData[clampedVel >> 1] - 239;
    return ((sensitivity * velValue + 7) >> 3) << 4;
}

int scaleRate(double midinote, int sensitivity) {
    const int x = clampInt((int)std::trunc(midinote / 3) - 7, 0, 31);
    return (sensitivity * x) >> 3;
}

int scaleLevel(double midinote, int breakPt, int leftDepth, int rightDepth, int leftCurve,
               int rightCurve) {
    const double offset = midinote - breakPt - 17;
    if (offset >= 0) {
        return scaleCurve((int)std::trunc((offset + 1) / 3), rightDepth, rightCurve);
    }
    return scaleCurve((int)std::trunc(-(offset - 1) / 3), leftDepth, leftCurve);
}

int operatorOutLevel(const uint8_t* patch, int off, double midinote, int velocity) {
    const int levelScaling = scaleLevel(midinote, patch[off + 8], patch[off + 9], patch[off + 10],
                                        patch[off + 11], patch[off + 12]);
    const int scaled = clampInt(scaleoutlevel(patch[off + 16]) + levelScaling, 0, 127);
    const int outlevel = (scaled << 5) + scaleVelocity(velocity, patch[off + 15]);
    return clampInt(outlevel, kOutlevelMin, kOutlevelMax);
}

Dx7Note::Dx7Note(std::shared_ptr<TuningState> ts) : tuningState(std::move(ts)) {
    for (int op = 0; op < 6; op++) {
        params[op].phase = 0;
        params[op].gain_out = 0;
        params[op].level_in = 0;
        params[op].freq = 0;
    }
}

int Dx7Note::amsForOp(int op, const uint8_t* patch) const {
    const int off = op * 21;
    int ams = patch[off + 14] & 3;
    if (supplement != nullptr) {
        const int ext = supplement->amsIndex(op);
        if (ext > 3) ams = ext;
    }
    return std::min(7, ams);
}

int32_t Dx7Note::oscFreq(double midinote, int mode, int coarse, int fine, int detune) const {
    double logfreq;
    if (mode == 0) {
        logfreq = tuningState->midinoteToLogfreq(midinote);
        const double detuneRatio =
            (0.0209 * std::exp(-0.396 * ((double)(float)logfreq / (1 << 24)))) / 7.0;
        logfreq = std::trunc(logfreq + detuneRatio * logfreq * (detune - 7));
        logfreq += coarsemul[coarse & 31];
        if (fine) logfreq += std::floor(24204406.323123 * std::log(1 + 0.01 * fine) + 0.5);
    } else {
        logfreq = (double)((4458616 * ((coarse & 3) * 100 + fine)) >> 3);
        // PATCH_ACTIVATE_OPERATOR_DETUNE writes the same signed +/-7 register
        // whatever PATCH_OP_MODE says, so detune is symmetric here too.
        logfreq += 13457 * (detune - 7);
    }
    return (int32_t)logfreq;
}

void Dx7Note::init(const uint8_t* patch, double midinote, int velocity, int, bool continueEnv) {
    initialised = true;
    bendGate = true;
    int32_t rates[4];
    int32_t levels[4];

    const VoiceSupplement* sup = supplement;
    pegShift = sup ? pegRangeShift[sup->pitchEgRange & 3] : 0;
    pegVelScale = (sup && sup->pitchEgVelSens) ? std::max(1, velocity) / 127.0 : 1.0;
    const int rndCents = randomPitchCents[sup ? sup->randomPitchDepth & 7 : 0];
    randPitchOffset =
        rndCents ? (int32_t)std::trunc(nextRandomUnit() * (((1 << 24) / 1200.0) * rndCents)) : 0;

    for (int op = 0; op < 6; op++) {
        const int off = op * 21;
        for (int i = 0; i < 4; i++) {
            rates[i] = patch[off + i];
            levels[i] = patch[off + 4 + i];
        }
        const int outlevel = operatorOutLevel(patch, off, midinote, velocity);
        const int rateScaling = scaleRate(midinote, patch[off + 13]);
        env[op].init(rates, levels, outlevel, rateScaling, continueEnv);

        const int mode = patch[off + 17];
        const int32_t freq = oscFreq(midinote, mode, patch[off + 18], patch[off + 19],
                                     patch[off + 20]) +
                             (mode == 0 ? randPitchOffset : 0);
        opMode[op] = mode;
        basepitch[op] = freq;
        ampmodsens[op] = kExtendedAmsTable[amsForOp(op, patch)];
    }
    notePitch = tuningState->midinoteToLogfreq(midinote) + randPitchOffset;
    portaCur = notePitch;

    const int pegRateAdj =
        (sup && sup->pitchEgScaleRate) ? scaleRate(midinote, sup->pitchEgScaleRate & 7) : 0;
    for (int i = 0; i < 4; i++) {
        rates[i] = std::min(99, patch[126 + i] + pegRateAdj);
        levels[i] = patch[130 + i];
    }
    pitchenv.set(rates, levels);

    algorithm = patch[134];
    const int feedback = patch[135];
    fbShift = feedback != 0 ? kFeedbackBitdepth - feedback : 16;
    pitchmoddepth = (patch[139] * 165) >> 6;
    pitchmodsens = pitchmodsenstab[patch[143] & 7];
    ampmoddepth = (patch[140] * 165) >> 6;

    mpePitchBend = 8192;
}

void Dx7Note::compute(int32_t* buf, int32_t lfoVal, int32_t lfoDelay, const Controllers& ctrls) {
    // ==== PITCH ====
    // MOD_PITCH_LOAD_TO_EGS builds one 8-bit factor by adding the delay-scaled
    // patch depth to the summed controller contributions and saturating at 255,
    // then multiplies the LFO by it. msfa takes the larger of the two instead.
    const int32_t senslfo = pitchmodsens * (lfoVal - (1 << 23));
    // Wide multiply then >> 24: depth * delay reaches 255 * 2^24. A signed
    // int32 fold wraps to -1 and kills vibrato at full fade-in.
    const int delayedDepth =
        (int)(((int64_t)pitchmoddepth * (int64_t)lfoDelay) >> 24);
    const int pitchModFactor = std::min(255, delayedDepth + ctrls.pitchMod * 2);
    int32_t pitchMod = (int32_t)std::llabs(sar64((int64_t)pitchModFactor * senslfo, 15));
    int32_t peg = pitchenv.getsample();
    if (pegShift) peg >>= pegShift;
    if (pegVelScale != 1.0) peg = (int32_t)std::trunc(peg * pegVelScale);
    pitchMod = peg + pitchMod * (senslfo < 0 ? -1 : 1);

    // ---- PITCH BEND ----
    // DX7II bend modes: the Part gates which notes respond (LOW/HIGH/K.ON).
    int32_t pb = bendGate ? ctrls.values_[kControllerPitch] - 0x2000 : 0;
    if (pb != 0) {
        if (ctrls.values_[kControllerPitchStep] == 0) {
            const int range = pb >= 0 ? ctrls.values_[kControllerPitchRangeUp]
                                      : ctrls.values_[kControllerPitchRangeDn];
            pb = (int32_t)std::trunc(((double)(pb << 11) * range) / 12.0);
        } else {
            const int stp = 12 / ctrls.values_[kControllerPitchStep];
            pb = (int32_t)std::trunc((double)(pb * stp) / 8191.0);
            pb = (int32_t)((uint32_t)(pb * (8191 / stp)) << 11);
        }
    }

    if (ctrls.mpeEnabled) {
        pb += (int32_t)std::trunc(
            ((double)((mpePitchBend - 0x2000) << 11) * ctrls.mpePitchBendRange) / 12.0);
    }

    // BC/AT pitch bias shifts pitch like a bend (applies to fixed ops too).
    const int32_t pitchBase = pb + ctrls.masterTune + ctrls.pitchBiasMod;
    pitchMod += pitchBase;

    // ==== AMP MOD + EG BIAS ====
    // MOD_AMP_LOAD_TO_EGS: sum the delay-scaled depth and the controller amount,
    // clamp so adding the EG bias cannot overflow, scale by the LFO, then add the
    // bias. msfa took the maximum of all three, so EG bias and LFO amp mod never
    // stacked.
    constexpr int64_t kFull = 1 << 24;
    const int64_t lfoValAmp = kFull - lfoVal;
    const int64_t bias = kFull - ((int64_t)(ctrls.egMod + 1) << 17);
    int64_t amdMod =
        std::min(kFull, sar64((int64_t)ampmoddepth * lfoDelay, 8) + ((int64_t)ctrls.ampMod << 17));
    amdMod = std::min(kFull, amdMod + bias) - bias;
    amdMod = std::min(kFull, sar64(amdMod * lfoValAmp, 24) + bias);

    const int32_t portaRate =
        ctrls.portamentoEnableCc
            ? (ctrls.portamentoGlissCc ? Porta::ratesGlissando[ctrls.portamentoCc]
                                       : Porta::rates[ctrls.portamentoCc])
            : Porta::rates[0];

    // ==== PORTAMENTO ====
    // One glide for the whole voice; operators ride on it via their fixed ratio
    // offset. `portaOffset` is the pre-advance position, matching msfa's ordering.
    int32_t portaOffset = 0;
    if (portaCur != notePitch) {
        const int32_t cur = portaCur;
        const int32_t dst = notePitch;
        const int32_t glide =
            ctrls.portamentoGlissCc ? logfreqRoundSemi(cur, std::max(1, ctrls.portamentoStepCc))
                                    : cur;
        portaOffset = glide - dst;

        const int32_t rate = portaStep(portaRate, dst - cur, ctrls.portamentoGlissCc);
        const bool goingUp = cur < dst;
        const int32_t next = cur + (goingUp ? rate : -rate);
        portaCur = goingUp ? std::min(next, dst) : std::max(next, dst);
    }

    // ==== OP RENDER ====
    for (int op = 0; op < 6; op++) {
        if (!ctrls.opSwitch[op]) {
            env[op].getsample();  // advance the envelope even when not playing
            params[op].level_in = 0;
            continue;
        }

        if (opMode[op]) {
            params[op].freq = Freqlut::lookup(basepitch[op] + pitchBase);
        } else {
            params[op].freq = Freqlut::lookup(basepitch[op] + portaOffset + pitchMod);
        }

        int32_t level = env[op].getsample();
        if (ampmodsens[op] != 0) {
            const int32_t sensamp = (int32_t)sar64(amdMod * ampmodsens[op], 24);
            const double raw = std::exp(((double)(float)sensamp / 262144.0) * 0.07 + 12.2);
            const uint32_t pt = raw >= 4294967295.0 ? 0xffffffffu : (uint32_t)raw;
            const int32_t ldiff = (int32_t)((((int64_t)level * pt) << 4) >> 28);
            level -= ldiff;
            // msfa's exp curve can slightly overshoot at AMS=max; a negative level
            // wraps inside Exp2 and sounds like clipping.
            if (level < 0) level = 0;
        }
        params[op].level_in = level;
    }
    ctrls.core->render(buf, params, algorithm, fbBuf, fbShift);
}

void Dx7Note::keyup() {
    for (int op = 0; op < 6; op++) env[op].keydown(false);
    pitchenv.keydown(false);
}

void Dx7Note::forceDamp() {
    for (int op = 0; op < 6; op++) env[op].forceDamp();
}

void Dx7Note::update(const uint8_t* patch, double midinote, int velocity, int) {
    int32_t rates[4];
    int32_t levels[4];

    for (int op = 0; op < 6; op++) {
        const int off = op * 21;
        const int mode = patch[off + 17];
        basepitch[op] =
            oscFreq(midinote, mode, patch[off + 18], patch[off + 19], patch[off + 20]) +
            (mode == 0 ? randPitchOffset : 0);
        ampmodsens[op] = kExtendedAmsTable[amsForOp(op, patch)];
        opMode[op] = mode;

        for (int i = 0; i < 4; i++) {
            rates[i] = patch[off + i];
            levels[i] = patch[off + 4 + i];
        }
        env[op].update(rates, levels, operatorOutLevel(patch, off, midinote, velocity),
                       scaleRate(midinote, patch[off + 13]));
    }
    // Keep the glide anchored if the tuning moved under us.
    notePitch = tuningState->midinoteToLogfreq(midinote) + randPitchOffset;
    const VoiceSupplement* sup = supplement;
    const int pegRateAdj =
        (sup && sup->pitchEgScaleRate) ? scaleRate(midinote, sup->pitchEgScaleRate & 7) : 0;
    for (int i = 0; i < 4; i++) {
        rates[i] = std::min(99, patch[126 + i] + pegRateAdj);
        levels[i] = patch[130 + i];
    }
    pitchenv.update(rates, levels);
    algorithm = patch[134];
    const int feedback = patch[135];
    fbShift = feedback != 0 ? kFeedbackBitdepth - feedback : 16;
    pitchmoddepth = (patch[139] * 165) >> 6;
    pitchmodsens = pitchmodsenstab[patch[143] & 7];
    ampmoddepth = (patch[140] * 165) >> 6;
}

void Dx7Note::peekVoiceStatus(VoiceStatus& status) const {
    for (int i = 0; i < 6; i++) {
        status.amp[i] = Exp2::lookup(params[i].level_in - 14 * (1 << 24));
        status.ampStep[i] = env[i].getPosition();
        status.level[i] = params[i].level_in;
    }
    status.pitchStep = pitchenv.getPosition();
    status.pitchLevel = pitchenv.getLevel();
}

void Dx7Note::transferState(const Dx7Note& src) {
    for (int i = 0; i < 6; i++) {
        env[i].transfer(src.env[i]);
        params[i].gain_out = src.params[i].gain_out;
        params[i].phase = src.params[i].phase;
    }
}

void Dx7Note::transferSignal(const Dx7Note& src) {
    for (int i = 0; i < 6; i++) {
        params[i].gain_out = src.params[i].gain_out;
        params[i].phase = src.params[i].phase;
    }
}

void Dx7Note::transferPhase(const Dx7Note& src) {
    for (int i = 0; i < 6; i++) params[i].phase = src.params[i].phase;
}

void Dx7Note::oscSync() {
    for (int i = 0; i < 6; i++) {
        params[i].gain_out = 0;
        params[i].phase = 0;
    }
}

bool Dx7Note::isPlaying() const {
    if (!initialised) return false;
    for (int i = 0; i < 6; i++) {
        if (FmCore::isCarrier(algorithm, i) && env[i].isActive()) return true;
    }
    return false;
}

}  // namespace texed
