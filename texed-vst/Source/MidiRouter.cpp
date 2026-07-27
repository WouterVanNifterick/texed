#include "MidiRouter.h"

#include <cmath>

#include "engine/synth_rack.h"

namespace texed {

namespace {

/** DX7 SysEx sub-status groups, as parsed by dx7-format/src/sysex.ts. */
constexpr int kGroupVoice = 0;
constexpr int kGroupVoiceHigh = 1;
constexpr int kGroupPerformance = 4;
constexpr int kGroupSupplement = 5;

/** The parameter a mixer CC drives, or Count when it is not one of ours. */
PartParam mixerCcParam(int ctrl) {
    switch (ctrl) {
        case 7: return PartParam::Volume;
        case 10: return PartParam::Pan;
        case 71: return PartParam::Resonance;
        case 74: return PartParam::Cutoff;
        case 91: return PartParam::ReverbSend;
        case 94: return PartParam::Detune;
        case 126:
        case 127: return PartParam::Mono;
        default: return PartParam::Count;
    }
}

/** TX816 performance parameter numbers, as MiniDexed reads them. */
constexpr int kPerfRxChannel = 1;
constexpr int kPerfMono = 2;
constexpr int kPerfPitchBendRange = 3;
constexpr int kPerfPortamentoTime = 5;
constexpr int kPerfWheelRange = 9;
constexpr int kPerfFootRange = 11;
constexpr int kPerfAftertouchRange = 13;
constexpr int kPerfBreathRange = 15;
constexpr int kPerfAttenuator = 26;

/** The 0..127 CC value on the parameter's own scale. */
float mixerCcValue(int ctrl, int value) {
    switch (ctrl) {
        case 10: return (value - 64) / 64.0f;
        // Onto the same -7..+7 the part rack offers, rounding half up.
        case 94: return std::floor(((value - 64) / 64.0f) * 7 + 0.5f);
        case 126: return 1;
        case 127: return 0;
        default: return value / 127.0f;
    }
}

}  // namespace

void HostRequestQueue::push(const HostRequest& r) {
    const auto scope = fifo.write(1);
    if (scope.blockSize1 + scope.blockSize2 == 0) return;
    slots[(size_t)(scope.blockSize1 > 0 ? scope.startIndex1 : scope.startIndex2)] = r;
}

void HostRequestQueue::drain(const std::function<void(const HostRequest&)>& fn) {
    const auto scope = fifo.read(fifo.getNumReady());
    for (int i = 0; i < scope.blockSize1; ++i) fn(slots[(size_t)(scope.startIndex1 + i)]);
    for (int i = 0; i < scope.blockSize2; ++i) fn(slots[(size_t)(scope.startIndex2 + i)]);
}

void MidiForwardQueue::push(const uint8_t* data, int size) {
    if (size <= 0 || size > kMaxFrame) {
        drops.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    const auto scope = fifo.write(1);
    if (scope.blockSize1 + scope.blockSize2 == 0) {
        drops.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    const auto slot = (size_t)(scope.blockSize1 > 0 ? scope.startIndex1 : scope.startIndex2);
    std::copy(data, data + size, frames[slot].begin());
    sizes[slot] = size;
}

void MidiForwardQueue::drain(const std::function<void(const uint8_t*, int)>& fn) {
    const auto scope = fifo.read(fifo.getNumReady());
    for (int i = 0; i < scope.blockSize1; ++i) {
        const auto slot = (size_t)(scope.startIndex1 + i);
        fn(frames[slot].data(), sizes[slot]);
    }
    for (int i = 0; i < scope.blockSize2; ++i) {
        const auto slot = (size_t)(scope.startIndex2 + i);
        fn(frames[slot].data(), sizes[slot]);
    }
}

MidiRouter::MidiRouter(SynthRack& r, HostRequestQueue& q, MidiForwardQueue& f)
    : rack(r), requests(q), forward(f) {
    for (auto& c : preOmniChannel) c = 1;
}

void MidiRouter::process(const juce::MidiBuffer& midi) {
    for (const auto meta : midi) {
        const auto m = meta.getMessage();
        const int channel = m.getChannel();
        if (m.isNoteOn()) {
            rack.noteOn(m.getNoteNumber(), m.getVelocity(), channel);
        } else if (m.isNoteOff()) {
            rack.noteOff(m.getNoteNumber(), channel);
        } else if (m.isAllNotesOff() || m.isAllSoundOff()) {
            rack.panic();
        } else if (m.isController()) {
            handleController(m.getControllerNumber(), m.getControllerValue(), channel);
        } else if (m.isPitchWheel()) {
            rack.pitchBend(m.getPitchWheelValue(), channel);
        } else if (m.isChannelPressure()) {
            rack.aftertouch(m.getChannelPressureValue(), channel);
        } else if (m.isProgramChange()) {
            // Resolving a program needs the voice library, which lives in the UI.
            forward.push(m.getRawData(), m.getRawDataSize());
        } else if (m.isSysEx()) {
            handleSysex(m.getRawData(), m.getRawDataSize());
        }
    }
}

void MidiRouter::handleController(int ctrl, int value, int channel) {
    // Bank select only means anything against the loaded banks, which the UI owns.
    if (ctrl == 0 || ctrl == 32) {
        const uint8_t bytes[3] = {(uint8_t)(0xb0 | ((channel - 1) & 0x0f)), (uint8_t)ctrl,
                                  (uint8_t)value};
        forward.push(bytes, 3);
        return;
    }

    const auto param = mixerCcParam(ctrl);
    const bool omni = ctrl == 124 || ctrl == 125;
    if (param == PartParam::Count && !omni) {
        rack.controlChange(ctrl, value, channel);
        return;
    }

    for (int i = 0; i < kNumParts; ++i) {
        if (!rack.receivesOn(i, channel)) continue;
        if (omni) {
            const int rx = ctrl == 124 ? preOmniChannel[i] : 0;
            requests.push({HostRequest::Kind::RxChannel, i, 0, (float)rx});
            continue;
        }
        requests.push({HostRequest::Kind::Part, i, (int)param, mixerCcValue(ctrl, value)});
    }
    if (!omni) return;
    // Remember the last explicit channel so omni-off has something to go back to.
    for (int i = 0; i < kNumParts; ++i) {
        const int rx = rack.getPartConfig(i).rxChannel;
        if (rx != 0) preOmniChannel[i] = rx;
    }
}

void MidiRouter::performanceParam(int part, int param, int value) {
    if (part >= kNumParts) return;
    const auto push = [&](PartParam p, float v) {
        requests.push({HostRequest::Kind::Part, part, (int)p, v});
    };
    // The controller sensitivities are 0..15 on the TX816 and 0..99 here.
    const float sens = (float)((value * 99) / 15);

    switch (param) {
        case kPerfRxChannel:
            return requests.push(
                {HostRequest::Kind::RxChannel, part, 0, (float)((value & 0x0f) + 1)});
        case kPerfMono: return push(PartParam::Mono, value ? 1.0f : 0.0f);
        case kPerfPitchBendRange: return push(PartParam::PitchBendRange, (float)(value & 0x0f));
        case kPerfPortamentoTime: return push(PartParam::PortamentoTime, (float)value);
        case kPerfWheelRange: return push(PartParam::WheelRange, sens);
        case kPerfFootRange: return push(PartParam::FootRange, sens);
        case kPerfAftertouchRange: return push(PartParam::AftertouchRange, sens);
        case kPerfBreathRange: return push(PartParam::BreathRange, sens);
        case kPerfAttenuator: {
            // Exponential on the real TX816, and 0 sounds the same as 1 rather
            // than silent: 7=127, 6=63, ... 1=1, 0=1.
            const int atten = value & 0x07;
            const int level = atten == 0 ? 1 : (127 >> (7 - atten));
            return push(PartParam::Volume, level / 127.0f);
        }
        default: break;
    }
}

void MidiRouter::handleSysex(const uint8_t* data, int size) {
    // Universal master volume: F0 7F 7F 04 01 ll mm F7.
    if (size >= 8 && data[1] == 0x7f && data[3] == 0x04 && data[4] == 0x01) {
        const int units = ((data[6] & 0x7f) << 7) | (data[5] & 0x7f);
        requests.push({HostRequest::Kind::Global, 0, (int)GlobalParam::Volume,
                       std::round(units / 16383.0f * 99)});
        return;
    }

    // Single parameter change: F0 43 1n gg pp vv F7. The sub-status nibble
    // addresses a part rather than a channel, as MiniDexed reads it.
    if (size >= 7 && data[1] == 0x43 && (data[2] & 0xf0) == 0x10) {
        const int part = data[2] & 0x0f;
        const int group = data[3] & 0x7f;
        // Group 4 is the TX816 performance set, which addresses the part rather
        // than the voice.
        if (group == kGroupPerformance) {
            return performanceParam(part, data[4] & 0x7f, data[5] & 0x7f);
        }
        const int param = data[4] & 0x7f;
        const int value = data[5] & 0x7f;
        if (part < kNumParts) {
            if (group == kGroupVoice || group == kGroupVoiceHigh) {
                const int offset = group * 128 + param;
                rack.setVoiceParamForPart(part, offset, value);
                requests.push({HostRequest::Kind::VoiceByte, part, offset, (float)value});
                return;
            }
            if (group == kGroupSupplement) {
                // Left for the message thread: some AMEM bytes are parameters, and
                // writing here as well would fight the next parameter sync.
                requests.push({HostRequest::Kind::SupplementByte, part, param, (float)value});
                return;
            }
        }
    }

    // Bulk dumps, performances and micro-tuning tables: the UI parses those.
    forward.push(data, size);
}

}  // namespace texed
