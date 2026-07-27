// Scalar math for DSP that has to render identically here and in the TypeScript
// engine. Port of dx7-engine/src/approx.ts; see that file for why libm is not
// used per sample. Everything is double, as JavaScript numbers are.

#pragma once

#include <cmath>

namespace texed {

namespace detail {

constexpr double kAtanC0 = 0.9999993329;
constexpr double kAtanC1 = -0.3332985605;
constexpr double kAtanC2 = 0.1994653599;
constexpr double kAtanC3 = -0.1390853351;
constexpr double kAtanC4 = 0.0964200441;
constexpr double kAtanC5 = -0.0559098861;
constexpr double kAtanC6 = 0.0218612288;
constexpr double kAtanC7 = -0.004054058;

constexpr double kHalfPi = 1.5707963267948966;

/** atan(x) for |x| <= 1 via an odd minimax polynomial (max error ~4e-8). */
inline double atanUnit(double x) {
    const double z = x * x;
    double p = kAtanC7;
    p = kAtanC6 + z * p;
    p = kAtanC5 + z * p;
    p = kAtanC4 + z * p;
    p = kAtanC3 + z * p;
    p = kAtanC2 + z * p;
    p = kAtanC1 + z * p;
    p = kAtanC0 + z * p;
    return x * p;
}

}  // namespace detail

/** Arctangent accurate to ~4e-8. The ladder filter's per-sample soft clipper. */
inline double atanApprox(double x) {
    if (x > 1) return detail::kHalfPi - detail::atanUnit(1 / x);
    if (x < -1) return -detail::kHalfPi - detail::atanUnit(1 / x);
    return detail::atanUnit(x);
}

/** CMSIS third-order log2: exponent split, cubic over the [0.5, 1) mantissa. */
inline double log2Approx(double x) {
    constexpr double p0 = 1.23149591368684;
    constexpr double p1 = -4.11852516267426;
    constexpr double p2 = 6.02197014179219;
    constexpr double p3 = -3.13396450166353;

    const double a = std::fabs(x);
    // frexp(0) yields a zero mantissa and exponent, so the polynomial collapses
    // to its constant term rather than diverging.
    if (a == 0 || !std::isfinite(a)) return p3;

    double e = std::floor(std::log2(a)) + 1;
    double f = a * std::pow(2.0, -e);
    if (f >= 1) {
        f *= 0.5;
        e += 1;
    } else if (f < 0.5) {
        f *= 2;
        e -= 1;
    }

    double y = p0;
    y = y * f + p1;
    y = y * f + p2;
    y = y * f + p3;
    return y + e;
}

inline double log10Approx(double x) {
    return log2Approx(x) * 0.3010299956639812;
}

inline double pow10Approx(double x) {
    return std::exp(2.302585092994 * x);
}

}  // namespace texed
