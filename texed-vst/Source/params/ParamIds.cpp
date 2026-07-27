#include "ParamIds.h"

namespace texed {

PartParam partFieldParam(PartField field) {
    switch (field) {
        case PartFieldVolume: return PartParam::Volume;
        case PartFieldPan: return PartParam::Pan;
        case PartFieldDetune: return PartParam::Detune;
        case PartFieldCutoff: return PartParam::Cutoff;
        case PartFieldResonance: return PartParam::Resonance;
        case PartFieldReverbSend: return PartParam::ReverbSend;
        default: return PartParam::Count;
    }
}

float partFieldValue(const PartConfig& cfg, PartField field) {
    switch (field) {
        case PartFieldVolume: return (float)cfg.volume;
        case PartFieldPan: return (float)cfg.pan;
        case PartFieldDetune: return (float)cfg.detune;
        case PartFieldCutoff: return (float)cfg.cutoff;
        case PartFieldResonance: return (float)cfg.resonance;
        case PartFieldReverbSend: return (float)cfg.reverbSend;
        default: return 0;
    }
}

}  // namespace texed
