#include "synth_rack.h"

#include <algorithm>
#include <cmath>

#include "tables.h"

namespace texed {

double volumeToGain(int volume) {
    const double v = std::max(0, std::min(99, volume)) / 99.0;
    return v * v;
}

SynthRack::SynthRack(double sampleRate) {
    initSynthTables(sampleRate);
    for (int i = 0; i < kNumParts; i++) {
        configs[(size_t)i] = PartConfig{};
        configs[(size_t)i].enabled = (i == 0);
        preOmniChannel[i] = 1;
        partFx[(size_t)i].dcBlock = false;
    }
    masterGain = volumeToGain(volume_);
    setEngineType(engineType);
    setSampleRate(sampleRate);
}

void SynthRack::setSampleRate(double sampleRate) {
    initSynthTables(sampleRate);
    for (auto& fx : partFx) fx.init(sampleRate);
    for (auto& c : compressors) c.init(sampleRate);
    reverb.init(sampleRate);
    fxL.init(sampleRate);
    fxR.init(sampleRate);
}

void SynthRack::setReverbSettings(const ReverbSettings& settings) {
    reverbSettings = settings;
    reverb.setSize(settings.size);
    reverb.setHiDamp(settings.hiDamp);
    reverb.setLoDamp(settings.loDamp);
    reverb.setLowpass(settings.lowpass);
    reverb.setDiffusion(settings.diffusion);
    reverb.setLevel(settings.level);
    // Flush the tail on the way out so re-enabling does not resume it.
    reverb.bypass = !settings.enabled;
}

void SynthRack::setCompressorEnabled(bool on) {
    if (on == compressorEnabled) return;
    compressorEnabled = on;
    for (auto& c : compressors) c.reset();
}

void SynthRack::setEngineType(EngineType type) {
    engineType = type;
    for (auto& p : parts) p.setEngineType(type);
}

void SynthRack::setPolyphonyCap(int n) {
    polyphonyCap = std::max(1, std::min(kNumParts * kMaxActiveNotes, n));
}

void SynthRack::setVolume(int volume) {
    volume_ = std::max(0, std::min(99, volume));
    masterGain = volumeToGain(volume_);
}

void SynthRack::applyMasterTuneCents(double cents) {
    masterTuneCents = cents;
    for (auto& p : parts) p.setMasterTuneCents(cents);
}

void SynthRack::setMicrotuning(const int32_t units[128]) {
    for (auto& p : parts) {
        p.setTuning(units ? createMicroTuning(units) : createStandardTuning());
        p.setMasterTuneCents(masterTuneCents);
    }
}

void SynthRack::selectPart(int index) {
    if (index >= 0 && index < kNumParts) selected = index;
}

void SynthRack::setPartConfig(int index, const PartConfig& cfg) {
    if (index < 0 || index >= kNumParts) return;
    configs[(size_t)index] = cfg;

    // Remember the last explicit channel so CC 124 (omni off) has something to
    // go back to instead of guessing.
    if (cfg.rxChannel != 0) preOmniChannel[index] = cfg.rxChannel;

    parts[(size_t)index].extraTranspose = cfg.noteShift;
    parts[(size_t)index].extraDetune = cfg.detune;
    parts[(size_t)index].forcedDamp = cfg.forcedDamp;
    if (!cfg.enabled) parts[(size_t)index].panic();

    // Keep the link group consistent after any change to a member, including a
    // link toggle, which can move `index` into or out of a group.
    syncLinkedSlaves(masterIndexOf(index));
}

void SynthRack::loadVoiceForPart(int index, const uint8_t* patch, const uint8_t* supplement) {
    if (index < 0 || index >= kNumParts) return;
    if (supplement) {
        parts[(size_t)index].loadVoiceSlot(patch, supplement);
    } else {
        parts[(size_t)index].loadVoice(patch);
    }
}

void SynthRack::setVoiceParamForPart(int index, int offset, int value) {
    if (index < 0 || index >= kNumParts) return;
    parts[(size_t)index].setVoiceParam(offset, value);
}

void SynthRack::setSupplementParamForPart(int index, int offset, int value) {
    if (index < 0 || index >= kNumParts) return;
    parts[(size_t)index].setSupplementParam(offset, value);
}

// ==== Link groups ====

bool SynthRack::isSlave(int index) const {
    // Part 0 can never be a slave: it has no part above to chain to.
    return index > 0 && configs[(size_t)index].link;
}

int SynthRack::masterIndexOf(int index) const {
    int i = index;
    while (i > 0 && configs[(size_t)i].link) i--;
    return i;
}

/** One past the last member of `master`'s contiguous run of linked slaves. */
int SynthRack::groupEnd(int master) const {
    int end = master + 1;
    while (end < kNumParts && configs[(size_t)end].link) end++;
    return end;
}

void SynthRack::syncLinkedSlaves(int master) {
    if (isSlave(master)) return;
    const PartConfig& m = configs[(size_t)master];
    for (int i = master + 1; i < kNumParts && configs[(size_t)i].link; i++) {
        PartConfig& s = configs[(size_t)i];
        const bool wasEnabled = s.enabled;
        s.enabled = m.enabled;
        parts[(size_t)i].forcedDamp = m.forcedDamp;
        if (wasEnabled && !s.enabled) parts[(size_t)i].panic();
    }
}

bool SynthRack::matches(int index, int channel) const {
    const PartConfig& cfg = configs[(size_t)index];
    if (!cfg.enabled) return false;
    // Slaves never match independently; they follow their master's routing.
    if (isSlave(index)) return false;
    return cfg.rxChannel == 0 || cfg.rxChannel == channel;
}

// ==== Polyphony ====

int SynthRack::totalActiveVoices() const {
    int n = 0;
    for (const auto& p : parts) n += p.activeVoiceCount();
    return n;
}

void SynthRack::enforceCap(int needed) {
    int guard = kNumParts * kMaxActiveNotes + needed;
    while (totalActiveVoices() + needed > polyphonyCap && guard-- > 0) {
        int bestPart = -1;
        int bestSeq = 0;
        bool bestReleased = false;
        for (int i = 0; i < kNumParts; i++) {
            const auto cand = parts[(size_t)i].stealCandidate();
            if (!cand.valid) continue;
            if (bestPart == -1 || (cand.released && !bestReleased) ||
                (cand.released == bestReleased && cand.seq < bestSeq)) {
                bestPart = i;
                bestSeq = cand.seq;
                bestReleased = cand.released;
            }
        }
        if (bestPart == -1) break;
        parts[(size_t)bestPart].killOldest();
    }
}

// ==== MIDI ====

void SynthRack::noteOn(int pitch, int velocity, int channel) {
    if (velocity == 0) {
        noteOff(pitch, channel);
        return;
    }
    for (int i = 0; i < kNumParts; i++) {
        if (!matches(i, channel)) continue;
        const PartConfig& cfg = configs[(size_t)i];
        if (!inNoteRange(pitch, cfg.noteLow, cfg.noteHigh)) continue;
        enforceCap(1);
        // Route to the least-busy member of the link group so a linked instrument
        // fills its combined voice pools (extended polyphony).
        int target = i;
        int fewest = parts[(size_t)i].activeVoiceCount();
        for (int m = i + 1; m < groupEnd(i); m++) {
            const int n = parts[(size_t)m].activeVoiceCount();
            if (n < fewest) {
                fewest = n;
                target = m;
            }
        }
        parts[(size_t)target].noteOn(pitch, velocity, channel);
    }
}

void SynthRack::noteOff(int pitch, int channel) {
    for (int i = 0; i < kNumParts; i++) {
        if (!matches(i, channel)) continue;
        // The note may live in any group pool, so release across all members.
        for (int m = i; m < groupEnd(i); m++) parts[(size_t)m].noteOff(pitch, channel);
    }
}

unsigned SynthRack::controlChange(int ctrl, int value, int channel) {
    unsigned changed = 0;
    for (int i = 0; i < kNumParts; i++) {
        if (!matches(i, channel)) continue;
        const CcRouting routing = rackControlChange(i, ctrl, value);
        if (routing == CcRouting::Config) changed |= 1u << i;
        if (routing != CcRouting::Voice) continue;
        for (int m = i; m < groupEnd(i); m++) parts[(size_t)m].controlChange(ctrl, value);
    }
    return changed;
}

CcRouting SynthRack::rackControlChange(int index, int ctrl, int value) {
    if (ctrl == 126 || ctrl == 127) {
        for (int m = index; m < groupEnd(index); m++) parts[(size_t)m].setMonoMode(ctrl == 126);
        return CcRouting::Consumed;
    }
    PartConfig cfg = configs[(size_t)index];
    const auto routing = applyMixerCc(cfg, preOmniChannel[index], ctrl, value);
    if (routing == CcRouting::Config) setPartConfig(index, cfg);
    return routing;
}

void SynthRack::pitchBend(int value14, int channel) {
    for (int i = 0; i < kNumParts; i++) {
        if (!matches(i, channel)) continue;
        for (int m = i; m < groupEnd(i); m++) parts[(size_t)m].pitchBend(value14);
    }
}

void SynthRack::aftertouch(int value, int channel) {
    for (int i = 0; i < kNumParts; i++) {
        if (!matches(i, channel)) continue;
        for (int m = i; m < groupEnd(i); m++) parts[(size_t)m].aftertouch(value);
    }
}

void SynthRack::panic() {
    for (auto& p : parts) p.panic();
}

const RackStatus& SynthRack::getStatus() {
    status.part = parts[(size_t)selected].getStatus();
    int total = 0;
    for (int i = 0; i < kNumParts; i++) {
        const int n = parts[(size_t)i].activeVoiceCount();
        status.partActivity[i] = n;
        total += n;
    }
    status.selectedPart = selected;
    status.totalActive = total;
    return status;
}

void SynthRack::ensureBuffers(int numSamples) {
    if ((int)scratch.size() >= numSamples) return;
    for (auto* buf : {&scratch, &sendL, &sendR, &wetL, &wetR}) {
        buf->assign((size_t)numSamples, 0.0f);
    }
}

void SynthRack::render(float* outL, float* outR, int numSamples) {
    if (numSamples <= 0) return;
    ensureBuffers(numSamples);
    const bool wet = reverbSettings.enabled;
    std::fill(outL, outL + numSamples, 0.0f);
    std::fill(outR, outR + numSamples, 0.0f);
    if (wet) {
        std::fill_n(sendL.begin(), numSamples, 0.0f);
        std::fill_n(sendR.begin(), numSamples, 0.0f);
    }

    for (int i = 0; i < kNumParts; i++) {
        // A linked slave is voiced by its master's volume/pan/enabled so the group
        // mixes as a single instrument.
        const PartConfig& cfg = configs[(size_t)masterIndexOf(i)];
        if (!cfg.enabled) continue;
        parts[(size_t)i].render(scratch.data(), numSamples);
        // Volume runs through the filter's ramped gain rather than the mix, so a
        // volume change slews over 100 ms instead of stepping.
        auto& fx = partFx[(size_t)i];
        fx.gain = cfg.volume;
        fx.cutoff = cfg.cutoff;
        fx.resonance = cfg.resonance;
        fx.process(scratch.data(), numSamples);
        if (compressorEnabled) compressors[(size_t)i].process(scratch.data(), numSamples);

        const double th = (cfg.pan + 1) * 0.25 * 3.14159265358979323846;
        const double gl = std::cos(th);
        const double gr = std::sin(th);
        for (int j = 0; j < numSamples; j++) {
            outL[j] = (float)(outL[j] + scratch[(size_t)j] * gl);
            outR[j] = (float)(outR[j] + scratch[(size_t)j] * gr);
        }

        // Post-fader and post-pan, on MiniDexed's fourth-power mixer taper.
        if (!wet || cfg.reverbSend <= 0) continue;
        const double send = cfg.reverbSend * cfg.reverbSend * cfg.reverbSend * cfg.reverbSend;
        const double sl = gl * send;
        const double sr = gr * send;
        for (int j = 0; j < numSamples; j++) {
            sendL[(size_t)j] = (float)(sendL[(size_t)j] + scratch[(size_t)j] * sl);
            sendR[(size_t)j] = (float)(sendR[(size_t)j] + scratch[(size_t)j] * sr);
        }
    }

    if (wet) {
        reverb.process(sendL.data(), sendR.data(), wetL.data(), wetR.data(), numSamples);
        const double level = reverbSettings.level;
        for (int j = 0; j < numSamples; j++) {
            outL[j] = (float)(outL[j] + wetL[(size_t)j] * level);
            outR[j] = (float)(outR[j] + wetR[(size_t)j] * level);
        }
    }

    fxL.process(outL, numSamples);
    fxR.process(outR, numSamples);

    for (int j = 0; j < numSamples; j++) {
        outL[j] = (float)(outL[j] * masterGain);
        outR[j] = (float)(outR[j] * masterGain);
    }
}

}  // namespace texed
