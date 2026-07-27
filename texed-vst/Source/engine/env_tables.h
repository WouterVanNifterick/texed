// The DX7 envelope lookup tables, and the integer functions built on them.
// Port of dx7-engine/src/env-tables.ts.
//
// Every function here maps an integer parameter to an integer engine quantity,
// exactly as msfa does. The sample-rate multiplier is a parameter rather than
// module state so the engine (mutable, follows the host) and any offline curve
// drawing (fixed 44.1 kHz reference) can share one implementation.

#pragma once

#include <cstdint>

namespace texed {

extern const int kPitchenvRate[100];
extern const int kPitchenvTab[100];

/** TABLE_KBD_SCALING_CURVE_EXP: doubles every 4 groups, then saturates. */
extern const int kKbdScalingCurveExp[36];

/** TABLE_KBD_SCALING_CURVE_LIN: 8 per group, saturating at index 32. */
extern const int kKbdScalingCurveLin[36];

int scaleoutlevel(int outlevel);

/**
 * The ROM's depth scaler, PATCH_ACTIVATE_SCALE_VALUE: `(660 * v) >> 8`. Used for
 * level scaling depth, LFO speed, LFO delay, and the LFO pitch/amp mod depths.
 */
int romScaleValue(int v);

/**
 * Level scaling contribution for one note group, in scaleoutlevel units.
 * Negative curves (0 = -LIN, 1 = -EXP) attenuate; positive (2 = +EXP, 3 = +LIN) boost.
 */
int kbdScaleCurve(int group, int depth, int curve);

/**
 * Velocity attenuation in `P_EGS_OP_LEVELS` units (0 = loudest, 255 = silent),
 * for MIDI velocity `velocity` and key velocity sensitivity `sensitivity` (0-7).
 */
int velocityAttenuation(int velocity, int sensitivity);

/** Amp EG target level before the per-operator output level is added in. */
int ampLevelBase(int newlevel);

/** Per-block level increment for an amp EG stage at raw rate `rate`. */
int32_t ampIncAt(int rate, int32_t srMul, int rateScaling);

/**
 * Length in samples of a static (no level change) amp EG stage. `staticrate` is
 * the raw rate plus rate scaling, already clamped to 99. `shortHold` is the
 * ix 0 / L1 = 0 case, which holds for a twentieth of the tabulated time.
 */
int32_t ampStaticAt(int staticrate, int32_t srMul, int shortHold);

/** Q24-per-octave target for a pitch EG level param. */
int32_t pitchLevelAt(int level);

/** Per-block level increment for a pitch EG stage at raw rate `rate`. */
int32_t pitchIncAt(int rate, int32_t unit);

}  // namespace texed
