#include "engine_accuracy.h"

namespace texed {

namespace {
EngineAccuracy current = EngineAccuracy::Hardware;
}

EngineAccuracy getEngineAccuracy() {
    return current;
}

bool isHardwareAccurate() {
    return current == EngineAccuracy::Hardware;
}

bool setEngineAccuracyMode(EngineAccuracy mode) {
    if (current == mode) return false;
    current = mode;
    return true;
}

}  // namespace texed
