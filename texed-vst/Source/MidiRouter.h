// Host MIDI in, split three ways: straight into the rack, into a parameter the
// message thread will set, or - when reading it needs format knowledge - copied
// out for the WebView to parse.
//
// Everything here is byte-level. No .syx, .ini or PMEM knowledge lives in C++.

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "params/Parameters.h"

namespace texed {

class SynthRack;

/** A change the audio thread wants made to state only the message thread owns. */
struct HostRequest {
    enum class Kind {
        Global,
        Part,
        RxChannel,
        /** One byte of the 156-byte voice; the rack already has it. */
        VoiceByte,
        /** One AMEM byte, which may land in a parameter instead. */
        SupplementByte,
    };
    Kind kind = Kind::Global;
    int part = 0;
    /** GlobalParam, PartParam or a byte offset, by kind. Unused for RxChannel. */
    int index = 0;
    float value = 0;
};

/** Bounded SPSC queue: written on the audio thread, drained on the message thread. */
class HostRequestQueue {
public:
    void push(const HostRequest& r);
    void drain(const std::function<void(const HostRequest&)>& fn);
    bool pending() const { return fifo.getNumReady() > 0; }

private:
    static constexpr int kSlots = 256;
    juce::AbstractFifo fifo{kSlots};
    std::array<HostRequest, kSlots> slots{};
};

/**
 * Bounded SPSC queue of raw MIDI the UI has to look at. Overflow drops the
 * newest frame rather than the oldest: the producer is the audio thread, and
 * reclaiming the oldest slot would mean moving a read index the consumer owns.
 */
class MidiForwardQueue {
public:
    /** Audio thread. Frames larger than one bulk dump are dropped. */
    void push(const uint8_t* data, int size);
    /** Message thread, oldest first. */
    void drain(const std::function<void(const uint8_t*, int)>& fn);
    /** Frames lost to a full queue, ever. Reported to the UI, not reset. */
    int dropped() const { return drops.load(std::memory_order_relaxed); }

private:
    // A 32-voice VMEM dump is 4104 bytes; round up for the AMEM bulk beside it.
    static constexpr int kMaxFrame = 4224;
    static constexpr int kSlots = 64;

    juce::AbstractFifo fifo{kSlots};
    std::array<std::array<uint8_t, kMaxFrame>, kSlots> frames;
    std::array<int, kSlots> sizes{};
    std::atomic<int> drops{0};
};

/**
 * Audio thread: turn one host MidiBuffer into rack calls, host requests and
 * forwarded frames. Owns only the small amount of state the split needs.
 */
class MidiRouter {
public:
    MidiRouter(SynthRack& rack, HostRequestQueue& requests, MidiForwardQueue& forward);

    void process(const juce::MidiBuffer& midi);

private:
    void handleController(int ctrl, int value, int channel);
    void handleSysex(const uint8_t* data, int size);
    /** One TX816 performance parameter, addressed by part rather than channel. */
    void performanceParam(int part, int param, int value);

    SynthRack& rack;
    HostRequestQueue& requests;
    MidiForwardQueue& forward;
    /** Receive channel to restore when CC 124 turns omni back off. */
    int preOmniChannel[kNumParts];
};

}  // namespace texed
