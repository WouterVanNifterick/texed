#include "part.h"

#include <algorithm>
#include <cmath>

#include "../msfa/exp2.h"

namespace texed {

Part::Part() {
    const uint8_t* init = initVoice();
    std::copy(init, init + kVoiceSize, data.begin());

    controllers.core = &mki;
    for (auto& v : voices) v.note = std::make_unique<Dx7Note>(tuningState);

    controllers.values_[kControllerPitch] = 0x2000;
    controllers.values_[kControllerPitchRangeUp] = 3;
    controllers.values_[kControllerPitchRangeDn] = 3;
    controllers.values_[kControllerPitchStep] = 0;
    controllers.masterTune = 0;
    // Canonical DX7 default mod routing: mod wheel adds pitch-LFO (vibrato),
    // aftertouch adds amplitude-LFO.
    controllers.wheel.pitchRange = 99;
    controllers.at.ampRange = 99;
    controllers.refresh();

    lfo.reset(&data[G::lfoSpeed]);
}

void Part::setEngineType(EngineType type) {
    switch (type) {
        case EngineType::Modern: controllers.core = &modern; break;
        case EngineType::Opl: controllers.core = &opl; break;
        case EngineType::MarkI:
        default: controllers.core = &mki; break;
    }
}

void Part::loadVoice(const uint8_t* patch) {
    clearActiveVoices();
    std::copy(patch, patch + kVoiceSize, data.begin());
    // A bare voice (VCED) leaves the DX7II supplement untouched, matching
    // hardware behaviour where a voice edit keeps the current ACED buffer.
    monoMode = supplement.mono;
    applySupplementToParts();
    refreshVoices();
}

void Part::loadVoiceSlot(const uint8_t* vmem, const uint8_t* amem) {
    clearActiveVoices();
    std::copy(vmem, vmem + kVoiceSize, data.begin());
    supplement = VoiceSupplement(amem);
    monoMode = supplement.mono;
    applySupplementToParts();
    refreshVoices();
}

void Part::setSupplementParam(int offset, int value) {
    if (offset < 0 || offset >= kAmemSlotSize) return;
    if (supplement.raw[(size_t)offset] == value) return;
    auto raw = supplement.raw;
    raw[(size_t)offset] = (uint8_t)(value & 0x7f);
    supplement = VoiceSupplement(raw.data());
    monoMode = supplement.mono;
    applySupplementToParts();
    refreshVoices();
}

void Part::applySupplementToParts() {
    applySupplementToControllers(supplement, controllers);
    for (auto& v : voices) v.note->setSupplement(&supplement);
}

void Part::setMasterTuneCents(double cents) {
    tuningState->setMasterTuneCents(cents);
    for (auto& v : voices) v.note->setTuningState(tuningState);
}

void Part::setTuning(std::shared_ptr<TuningState> state) {
    tuningState = std::move(state);
    for (auto& v : voices) v.note->setTuningState(tuningState);
}

void Part::setVoiceParam(int offset, int value) {
    if (offset < 0 || offset > 155) return;
    if (data[(size_t)offset] == value) return;
    data[(size_t)offset] = (uint8_t)value;
    refreshVoices();
    // delayinc updates in reset, but an already-finished ramp would stay full;
    // clear so editing DELAY while a note rings restarts the hold/fade.
    if (offset == G::lfoDelay) lfo.restartDelay();
}

void Part::clearActiveVoices() {
    for (auto& v : voices) {
        if (!v.live) continue;
        v.keydown = false;
        v.sustained = false;
        v.sostenuto = false;
        v.hold2 = false;
        v.damping = false;
        v.note->keyup();
        v.live = false;
        v.midiNote = -1;
    }
}

void Part::refreshVoices() {
    for (int op = 0; op < 6; op++) {
        controllers.opSwitch[op] = (data[G::opEnable] & (1 << op)) != 0;
    }
    for (auto& v : voices) {
        if (!v.live) continue;
        v.note->setSupplement(&supplement);
        v.note->update(data.data(), enginePitch(v.midiNote), v.velocity, v.channel);
    }
    lfo.reset(&data[G::lfoSpeed]);
}

// ==== MIDI handling ====

int Part::chooseNote(int pitch) const {
    int bestNote = currentNote;
    int bestScore = -1;
    int note = currentNote;
    for (int i = 0; i < kMaxActiveNotes; i++) {
        int score = 0;
        if (!voices[(size_t)note].note->isPlaying()) score += 4;
        if (!voices[(size_t)note].keydown) score += 2;
        if (voices[(size_t)note].midiNote == pitch) score += 1;
        if (score > bestScore ||
            (score == bestScore &&
             voices[(size_t)note].keydownSeq < voices[(size_t)bestNote].keydownSeq)) {
            bestNote = note;
            bestScore = score;
        }
        note = (note + 1) % kMaxActiveNotes;
    }
    return bestNote;
}

int Part::transpositionShift() const {
    return data[G::transpose] - 24 + extraTranspose;
}

double Part::enginePitch(int midiNote) const {
    return midiNote + transpositionShift() + extraDetune / 100.0;
}

void Part::noteOn(int pitch, int velocity, int channel) {
    if (velocity == 0) {
        noteOff(pitch, channel);
        return;
    }

    if (monoMode) {
        for (auto& v : voices) {
            if (v.keydown) {
                v.keydown = false;
                v.note->keyup();
            }
        }
    }

    // Hold-2 keeps notes ringing after key-up, and lets go of them when a new
    // note starts a fresh phrase rather than when the pedal lifts.
    if (hold2 && !anyKeyDown()) {
        for (auto& v : voices) {
            if (!v.hold2) continue;
            v.hold2 = false;
            maybeRelease(v);
        }
    }

    // LFO key trigger: "single" restarts only on the first key down; "multi"
    // (AMEM LTRG) retriggers on every note-on.
    bool triggerLfo = supplement.lfoKeyTrigger;
    if (!triggerLfo) {
        triggerLfo = true;
        for (const auto& v : voices) {
            if (v.keydown) {
                triggerLfo = false;
                break;
            }
        }
    }
    if (triggerLfo) {
        lfo.keydown();
        lfoRestartSeq++;
    }

    // DX7II unison poly: stack four detuned voices per note (hardware plays
    // 4 notes of the 16-voice pool per key in single mode).
    if (supplement.unison) {
        const double spreadCents = (supplement.unisonDetune + 1) * 5.0;
        for (const double k : {-1.5, -0.5, 0.5, 1.5}) {
            triggerVoice(pitch, velocity, channel, k * spreadCents);
        }
    } else {
        triggerVoice(pitch, velocity, channel, 0);
    }
}

void Part::triggerVoice(int pitch, int velocity, int channel, double detuneCents) {
    const int note = chooseNote(pitch);
    currentNote = (note + 1) % kMaxActiveNotes;
    Voice& v = voices[(size_t)note];
    v.channel = channel;
    v.midiNote = pitch;
    v.velocity = velocity;
    v.sustained = sustain;
    v.sostenuto = false;
    v.hold2 = false;
    v.keydown = true;
    v.damping = false;
    v.keydownSeq = nextKeydownSeq++;

    const bool voiceSteal = v.note->isPlaying();
    // Forced Damp OFF: a stolen (still-playing) slot continues its envelope into
    // the new note. ON (or a free slot): restart the envelope from the beginning.
    const bool continueEnv = voiceSteal && !forcedDamp;
    v.note->setSupplement(&supplement);
    v.note->init(data.data(), enginePitch(pitch) + detuneCents / 100.0, velocity, channel,
                 continueEnv);
    if (data[G::oscKeySync] && !voiceSteal) v.note->oscSync();

    if (voices[(size_t)lastActiveVoice].midiNote != -1 && controllers.portamentoEnableCc &&
        controllers.portamentoCc > 0) {
        v.note->initPortamento(*voices[(size_t)lastActiveVoice].note);
    }

    if (!data[G::oscKeySync]) {
        for (int i = 0; i < kMaxActiveNotes; i++) {
            if (i != note && voices[(size_t)i].note->isPlaying() &&
                voices[(size_t)i].midiNote == pitch) {
                v.note->transferPhase(*voices[(size_t)i].note);
                break;
            }
        }
    }

    v.live = true;
    lastActiveVoice = note;
}

void Part::noteOff(int pitch, int channel) {
    // Release every matching voice: unison stacks several voices per note.
    bool released = false;
    for (auto& v : voices) {
        if (v.midiNote == pitch && v.keydown && v.channel == channel) {
            keyUp(v);
            released = true;
        }
    }
    if (released) return;

    for (auto& v : voices) {
        if (v.midiNote == pitch && v.keydown) keyUp(v);
    }
}

bool Part::anyKeyDown() const {
    for (const auto& v : voices) {
        if (v.keydown) return true;
    }
    return false;
}

void Part::keyUp(Voice& v) {
    v.keydown = false;
    if (sustain) v.sustained = true;
    if (hold2) v.hold2 = true;
    maybeRelease(v);
}

void Part::maybeRelease(Voice& v) {
    if (!v.keydown && !v.sustained && !v.sostenuto && !v.hold2) v.note->keyup();
}

void Part::controlChange(int ctrl, int value) {
    switch (ctrl) {
        case 1:
            controllers.modwheelCc = value;
            controllers.refresh();
            break;
        case 2:
            controllers.breathCc = value;
            controllers.refresh();
            break;
        case 4:
            controllers.footCc = value;
            controllers.refresh();
            break;
        case 5: controllers.portamentoCc = value; break;
        case 11:
            // Foot controller 2, mapped to CC 11 (expression) here.
            controllers.foot2Cc = value;
            controllers.foot2Seen = true;
            controllers.refresh();
            break;
        case 13:
            // "MIDI IN controller" (DX7II assignable CC; fixed to CC 13 here).
            controllers.midiCsCc = value;
            controllers.midiCsSeen = true;
            controllers.refresh();
            break;
        case 64: setSustain(value > 63); break;
        case 65: controllers.portamentoEnableCc = value >= 64; break;
        case 66: setSostenuto(value > 63); break;
        case 69: setHold2(value > 63); break;
        case 120:
        case 123: panic(); break;
        default: break;
    }
}

void Part::setSustain(bool on) {
    sustain = on;
    if (on) return;
    for (auto& v : voices) {
        if (!v.sustained) continue;
        v.sustained = false;
        maybeRelease(v);
    }
}

void Part::setSostenuto(bool on) {
    for (auto& v : voices) {
        if (on) {
            if (v.live && v.keydown) v.sostenuto = true;
        } else if (v.sostenuto) {
            v.sostenuto = false;
            maybeRelease(v);
        }
    }
}

void Part::setHold2(bool on) {
    hold2 = on;
    if (on) return;
    for (auto& v : voices) {
        if (!v.hold2) continue;
        v.hold2 = false;
        maybeRelease(v);
    }
}

void Part::aftertouch(int value) {
    controllers.aftertouchCc = value;
    controllers.refresh();
}

void Part::pitchBend(int value14) {
    controllers.values_[kControllerPitch] = value14 & 0x3fff;
}

void Part::panic() {
    for (auto& v : voices) {
        v.midiNote = -1;
        v.keydown = false;
        v.sustained = false;
        v.sostenuto = false;
        v.hold2 = false;
        v.damping = false;
        v.live = false;
        v.note->keyup();
        v.note->oscSync();
    }
}

// ==== Shared-budget voice stealing (used by the rack) ====

int Part::activeVoiceCount() const {
    int n = 0;
    for (const auto& v : voices) {
        if (v.live && !v.damping && v.note->isPlaying()) n++;
    }
    return n;
}

bool Part::hasActiveVoices() const {
    for (const auto& v : voices) {
        if (v.live && v.note->isPlaying()) return true;
    }
    return false;
}

Part::StealCandidate Part::stealCandidate() const {
    StealCandidate best;
    for (const auto& v : voices) {
        if (!v.live || v.damping || !v.note->isPlaying()) continue;
        const bool released = !v.keydown;
        if (!best.valid || (released && !best.released) ||
            (released == best.released && v.keydownSeq < best.seq)) {
            best.valid = true;
            best.seq = v.keydownSeq;
            best.released = released;
        }
    }
    return best;
}

void Part::killOldest() {
    const StealCandidate cand = stealCandidate();
    if (!cand.valid) return;
    for (auto& v : voices) {
        if (v.live && !v.damping && v.note->isPlaying() && v.keydownSeq == cand.seq &&
            (!v.keydown) == cand.released) {
            v.keydown = false;
            v.damping = true;
            v.note->forceDamp();
            return;
        }
    }
}

// ==== Status ====

const PartStatus& Part::getStatus() {
    const Voice* voice =
        voices[(size_t)lastActiveVoice].live ? &voices[(size_t)lastActiveVoice] : nullptr;
    if (voice == nullptr) {
        for (const auto& v : voices) {
            if (v.live) {
                voice = &v;
                break;
            }
        }
    }
    if (voice != nullptr) {
        voice->note->peekVoiceStatus(peekStatus);
        for (int op = 0; op < 6; op++) {
            const int32_t a = peekStatus.amp[op];
            status.amps[op] =
                a > 1024 ? std::min(1.0f, (float)((std::log2((double)a) - 10) / 16)) : 0.0f;
            status.steps[op] = peekStatus.ampStep[op];
            status.levels[op] = peekStatus.level[op];
        }
        status.pitchStep = peekStatus.pitchStep;
        status.pitchLevel = peekStatus.pitchLevel;
    } else {
        for (int op = 0; op < 6; op++) {
            status.amps[op] = 0;
            status.steps[op] = 4;
            status.levels[op] = 0;
        }
        status.pitchStep = 4;
        status.pitchLevel = 0;
    }
    // Scale the LFO excursion by the delay ramp so the meter reflects the
    // modulation that actually reaches the voices.
    const float ramp = (float)lastLfoDelay / (1 << 24);
    status.lfo = 0.5f + ((float)lastLfoValue / (1 << 24) - 0.5f) * ramp;
    status.lfoRestart = lfoRestartSeq;
    return status;
}

void Part::updateBendGates() {
    // DX7II pitch bend modes (AMEM PBM): NORMAL = all voices; LOW/HIGH = lowest
    // or highest held note only; K.ON = physically held keys only.
    const int mode = supplement.pitchBendMode;
    if (mode == 0) {
        for (auto& v : voices) v.note->bendGate = true;
        return;
    }
    if (mode == 3) {
        for (auto& v : voices) v.note->bendGate = v.keydown;
        return;
    }
    int extreme = -1;
    for (const auto& v : voices) {
        if (!v.live || !v.keydown || v.midiNote < 0) continue;
        if (extreme == -1 || (mode == 1 ? v.midiNote < extreme : v.midiNote > extreme)) {
            extreme = v.midiNote;
        }
    }
    for (auto& v : voices) v.note->bendGate = v.keydown && v.midiNote == extreme;
}

// ==== Render (mono, no FX) ====

void Part::render(float* out, int numSamples) {
    updateBendGates();
    int i = 0;

    for (i = 0; i < numSamples && i < extraBufSize; i++) out[i] = extraBuf[(size_t)i];

    if (extraBufSize > numSamples) {
        for (int j = 0; j < extraBufSize - numSamples; j++) {
            extraBuf[(size_t)j] = extraBuf[(size_t)(j + numSamples)];
        }
        extraBufSize -= numSamples;
        return;
    }

    for (; i < numSamples; i += N) {
        audiobuf.fill(0);
        sumbuf.fill(0.0f);

        const int32_t lfovalue = lfo.getsample();
        const int32_t lfodelay = lfo.getdelay();
        lastLfoValue = lfovalue;
        lastLfoDelay = lfodelay;

        for (auto& v : voices) {
            if (!v.live) continue;
            // Reap voices whose forced-damp fade has reached silence.
            if (v.damping && !v.note->isPlaying()) {
                v.live = false;
                v.damping = false;
                v.midiNote = -1;
                continue;
            }
            v.note->compute(audiobuf.data(), lfovalue, lfodelay, controllers);
            for (int j = 0; j < N; j++) {
                const int32_t val = audiobuf[(size_t)j] >> 4;
                // 0x8000 (positive) for the negative overflow is upstream msfa
                // behaviour that part.ts copies; keep it so the two engines null.
                const int32_t clipVal =
                    val < -(1 << 24) ? 0x8000 : (val >= (1 << 24) ? 0x7fff : (val >> 9));
                float f = (float)clipVal / 0x8000;
                if (f > 1) f = 1;
                if (f < -1) f = -1;
                sumbuf[(size_t)j] += f;
                audiobuf[(size_t)j] = 0;
            }
        }

        // DX7II controller volume (FC1/FC2/MIDI-ctrl volume ranges).
        const float vol = controllers.volMod;
        if (vol != 1.0f) {
            for (int j = 0; j < N; j++) sumbuf[(size_t)j] *= vol;
        }

        const int jmax = numSamples - i;
        for (int j = 0; j < N; j++) {
            if (j < jmax) {
                out[i + j] = sumbuf[(size_t)j];
            } else {
                extraBuf[(size_t)(j - jmax)] = sumbuf[(size_t)j];
            }
        }
    }
    extraBufSize = i - numSamples;
}

}  // namespace texed
