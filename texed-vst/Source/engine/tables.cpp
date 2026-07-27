#include "tables.h"

// synth.h first: the msfa headers below expect its integer typedefs.
#include "../msfa/synth.h"

#include "../msfa/exp2.h"
#include "../msfa/freqlut.h"
#include "../msfa/sin.h"
#include "env.h"
#include "lfo.h"
#include "pitchenv.h"
#include "porta.h"

namespace texed {

namespace {

bool tablesInited = false;
double lastSampleRate = 44100.0;

void initTablesOnce() {
    if (tablesInited) return;
    Exp2::init();
    Tanh::init();
    Sin::init();
    tablesInited = true;
}

}  // namespace

void initSynthTables(double sampleRate) {
    initTablesOnce();
    lastSampleRate = sampleRate;
    Freqlut::init(sampleRate);
    Lfo::init(sampleRate);
    PitchEnv::init(sampleRate);
    Env::initSr(sampleRate);
    Porta::initSr(sampleRate);
}

void setEngineAccuracy(EngineAccuracy mode) {
    if (setEngineAccuracyMode(mode)) initSynthTables(lastSampleRate);
}

}  // namespace texed
