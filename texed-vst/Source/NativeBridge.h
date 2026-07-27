#pragma once

// Marshalling for the SynthPort protocol across the JUCE WebView bridge.
//
// The wire format is exactly what texed-ts/src/audio/native-bridge-port.ts
// sends: the same `SynthCommand` objects the AudioWorklet receives, as JSON,
// with byte arrays wrapped as `{ "$b64": "..." }`. Nothing above the transport
// knows the bridge exists, so the React app is identical in both hosts.
//
// Threading: the WebView callback runs on the message thread and pushes onto a
// preallocated queue that processBlock drains. The audio thread never allocates
// and never touches the WebView.

#include <atomic>
#include <juce_core/juce_core.h>
#include <vector>

#include "engine/synth_rack.h"
#include "params/ParamIds.h"

namespace texed {

/**
 * Commands the C++ rack understands. Anything else is dropped by fromJson: the
 * voice library, performances and SysEx parsing live in TypeScript, and the UI
 * resolves those into the commands below before sending them down.
 */
enum class CommandType {
    None,
    NoteOn,
    NoteOff,
    Cc,
    PitchBend,
    Aftertouch,
    Panic,
    SetVolume,
    SetParam,
    SetSupplementParam,
    SetEngine,
    SetAccuracy,
    SetMasterTune,
    SetPolyphonyCap,
    SelectPart,
    SetPart,
    LoadVoice,
};

/**
 * One decoded command. Fixed size apart from `bytes`, whose capacity is grown
 * on the message thread and then reused, so draining never allocates.
 */
struct Command {
    CommandType type = CommandType::None;
    int a = 0;  // note / controller / offset / index
    int b = 0;  // velocity / value
    int channel = 1;
    double value = 0;  // master tune cents
    PartConfig config;
    std::vector<uint8_t> bytes;
    /** LoadVoice only: the 35-byte AMEM supplement, appended after the voice. */
    bool hasSupplement = false;
};

/** A `setGlobal` or `setAccuracy` patch, decoded but not yet routed. */
struct GlobalPatch {
    /** Bit per GlobalParam, for the values the patch carried. */
    unsigned mask = 0;
    float values[kNumGlobalParams]{};
    bool hasAccuracy = false;
    bool dexedAccuracy = false;
};
bool globalPatchFromJson(const juce::var& json, GlobalPatch& out);

/** A `paramGesture` bracket around a UI drag. */
struct GesturePatch {
    int part = 0;
    PartParam param = PartParam::Count;
    bool begin = false;
};
bool gestureFromJson(const juce::var& json, GesturePatch& out);

/**
 * Single-producer/single-consumer command queue: the message thread writes,
 * processBlock reads. Slots keep their byte buffers between uses.
 */
class CommandQueue {
public:
    explicit CommandQueue(int capacity = 512) : fifo(capacity), slots((size_t)capacity) {}

    /** Message thread. Returns false when the queue is full (command dropped). */
    template <typename Fill>
    bool push(Fill&& fill) {
        const auto scope = fifo.write(1);
        if (scope.blockSize1 + scope.blockSize2 == 0) {
            dropped.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        const int index = scope.blockSize1 > 0 ? scope.startIndex1 : scope.startIndex2;
        fill(slots[(size_t)index]);
        return true;
    }

    /** Audio thread. Applies every pending command in order. */
    template <typename Apply>
    void drain(Apply&& apply) {
        for (;;) {
            const auto scope = fifo.read(fifo.getNumReady());
            if (scope.blockSize1 + scope.blockSize2 == 0) return;
            for (int i = 0; i < scope.blockSize1; ++i) apply(slots[(size_t)(scope.startIndex1 + i)]);
            for (int i = 0; i < scope.blockSize2; ++i) apply(slots[(size_t)(scope.startIndex2 + i)]);
        }
    }

    int getDroppedCount() const { return dropped.load(std::memory_order_relaxed); }

private:
    juce::AbstractFifo fifo;
    std::vector<Command> slots;
    std::atomic<int> dropped{0};
};

/**
 * Decode one `SynthCommand` from the WebView. False when we do not handle it.
 * For `setPart`, `out.config` holds only the fields listed in `*partFields`;
 * the caller merges them against its own copy before queueing.
 */
bool commandFromJson(const juce::var& json, Command& out, unsigned* partFields = nullptr);

/** Base64 helpers for the binary fields the JSON transport cannot carry. */
juce::String toBase64(const uint8_t* data, size_t size);
std::vector<uint8_t> fromBase64(const juce::String& text);

/** Wrap bytes the way `native-bridge-port.ts` expects to decode them. */
juce::var binaryVar(const uint8_t* data, size_t size);

/**
 * Apply one command to the rack. Called on the audio thread by the plugin and
 * inline by texed-render, so both drive the engine through the same path.
 */
void applyCommand(SynthRack& rack, const Command& cmd);

}  // namespace texed
