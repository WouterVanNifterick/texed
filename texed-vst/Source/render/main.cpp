// texed-render: drives the C++ rack headlessly, so its output can be compared
// against the TypeScript engine's. Two modes:
//
//   texed-render --commands score.jsonl --seconds 3 --out out.wav
//       Plays a score of SynthCommand JSON objects, one per line, and writes a
//       WAV. Commands go through the same decoder the WebView bridge uses, so
//       this stays on exactly the code path the plugin takes. Without
//       --commands it plays a single middle C, enough for a smoke test.
//
//   texed-render --null-cases cases.bin --out-pcm pcm.bin
//       Replays the case list written by the null test in texed-ts and dumps
//       raw float32 stereo, for the null comparison. The case file carries
//       decoded voices and a timed event list, so nothing here parses SysEx and
//       the test owns what gets played.

#include <cstring>
#include <juce_audio_formats/juce_audio_formats.h>

#include "../NativeBridge.h"
#include "../engine/tables.h"

namespace {

constexpr double kSampleRate = 44100.0;
constexpr int kBlockSize = 64;

constexpr double kNullSampleRate = 44100.0;

/** One command plus the sample offset it takes effect at. */
struct TimedCommand {
    int64_t sample;
    texed::Command command;
};

std::vector<TimedCommand> defaultScore() {
    std::vector<TimedCommand> score;
    texed::Command on;
    on.type = texed::CommandType::NoteOn;
    on.a = 60;
    on.b = 100;
    score.push_back({0, on});

    texed::Command off;
    off.type = texed::CommandType::NoteOff;
    off.a = 60;
    score.push_back({(int64_t)(kSampleRate * 1.0), off});
    return score;
}

/**
 * Read a JSON-lines score. Each line is `{"at": <seconds>, "cmd": { ... }}`,
 * where `cmd` is a SynthCommand exactly as the bridge would deliver it.
 */
std::vector<TimedCommand> readScore(const juce::File& file) {
    std::vector<TimedCommand> score;
    for (const auto& line : juce::StringArray::fromLines(file.loadFileAsString())) {
        if (line.trim().isEmpty()) continue;
        const auto parsed = juce::JSON::parse(line);
        const auto* obj = parsed.getDynamicObject();
        if (obj == nullptr) continue;

        TimedCommand timed{};
        timed.sample = (int64_t)((double)obj->getProperty("at") * kSampleRate);
        if (texed::commandFromJson(obj->getProperty("cmd"), timed.command)) {
            score.push_back(std::move(timed));
        }
    }
    return score;
}

/** Accepts both `--opt=value` and `--opt value`; JUCE only handles the former. */
juce::String valueFor(const juce::ArgumentList& args, juce::StringRef option) {
    const auto inlineValue = args.getValueForOption(option);
    if (inlineValue.isNotEmpty()) return inlineValue;

    const auto index = args.indexOfOption(option);
    if (index >= 0 && index + 1 < args.size() && !args[index + 1].isOption()) {
        return args[index + 1].text;
    }
    return {};
}

int fail(const juce::String& message) {
    std::fprintf(stderr, "%s\n", message.toRawUTF8());
    return 1;
}

int usage() {
    std::fprintf(stderr,
                 "usage: texed-render [--commands score.jsonl] [--seconds N] --out out.wav\n"
                 "       texed-render --null-cases cases.bin --out-pcm pcm.bin\n");
    return 2;
}

/**
 * Opcodes in the case file's event lists. This little numbering is the null
 * test's own wire format, mirrored by the writer in native-null.test.ts; it maps
 * onto Command so the events run through the same applier the plugin uses.
 */
enum class NullOp : uint8_t {
    NoteOn = 0,
    NoteOff = 1,
    Cc = 2,
    PitchBend = 3,
    Aftertouch = 4,
    SetParam = 5,
    SetSupplementParam = 6,
};

/** Sequential reader over the case file, so a malformed file cannot overrun. */
class Cursor {
public:
    Cursor(const uint8_t* data, size_t size) : p(data), end(data + size) {}

    bool ok() const { return p <= end; }
    bool has(size_t n) const { return (size_t)(end - p) >= n; }

    template <typename T>
    T read() {
        T value{};
        if (!has(sizeof(T))) {
            p = end + 1;
            return value;
        }
        std::memcpy(&value, p, sizeof(T));
        p += sizeof(T);
        return value;
    }

    const uint8_t* readBytes(size_t n) {
        if (!has(n)) {
            p = end + 1;
            return nullptr;
        }
        const auto* at = p;
        p += n;
        return at;
    }

private:
    const uint8_t* p;
    const uint8_t* end;
};

int renderNullCases(const juce::File& caseFile, const juce::File& outFile) {
    juce::MemoryBlock raw;
    if (!caseFile.loadFileAsData(raw)) return fail("cannot read " + caseFile.getFullPathName());

    Cursor in(static_cast<const uint8_t*>(raw.getData()), raw.getSize());
    const auto* magic = in.readBytes(4);
    if (magic == nullptr || std::memcmp(magic, "TXN2", 4) != 0) return fail("not a case file");

    const auto count = in.read<uint32_t>();
    const auto blocks = (int)in.read<uint32_t>();
    const auto blockSize = (int)in.read<uint32_t>();
    if (!in.ok() || blocks <= 0 || blockSize <= 0) return fail("bad case file header");

    outFile.deleteFile();
    std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
    if (out == nullptr) return fail("cannot write " + outFile.getFullPathName());

    std::vector<float> buffer((size_t)blockSize * 2);
    for (uint32_t i = 0; i < count; i++) {
        const auto accuracy = in.read<uint8_t>();
        const auto engine = in.read<uint8_t>();
        const auto eventCount = in.read<uint16_t>();
        const auto* voice = in.readBytes(texed::kVoiceSize);
        if (!in.ok()) return fail("truncated case file");

        texed::setEngineAccuracy(accuracy == 1 ? texed::EngineAccuracy::Dexed
                                               : texed::EngineAccuracy::Hardware);
        const auto compressor = in.read<uint8_t>();
        texed::ReverbSettings reverb;
        reverb.enabled = in.read<uint8_t>() == 1;
        reverb.size = in.read<double>();
        reverb.hiDamp = in.read<double>();
        reverb.loDamp = in.read<double>();
        reverb.lowpass = in.read<double>();
        reverb.diffusion = in.read<double>();
        reverb.level = in.read<double>();
        const auto reverbSend = in.read<double>();
        const auto cutoff = in.read<double>();
        const auto resonance = in.read<double>();
        if (!in.ok()) return fail("truncated case file");

        texed::SynthRack rack(kNullSampleRate);
        rack.setEngineType((texed::EngineType)engine);
        rack.loadVoiceForPart(0, voice);
        rack.setCompressorEnabled(compressor == 1);
        rack.setReverbSettings(reverb);
        auto config = rack.getPartConfig(0);
        config.reverbSend = reverbSend;
        config.cutoff = cutoff;
        config.resonance = resonance;
        rack.setPartConfig(0, config);

        // Read the whole event list up front: it is ordered by block, so the
        // render loop only has to walk it.
        struct TimedEvent {
            int block;
            texed::Command command;
        };
        std::vector<TimedEvent> events;
        events.reserve(eventCount);
        for (uint16_t e = 0; e < eventCount; e++) {
            TimedEvent timed{};
            timed.block = in.read<int32_t>();
            const auto op = (NullOp)in.read<uint8_t>();
            timed.command.channel = in.read<uint8_t>();
            timed.command.a = in.read<int16_t>();
            timed.command.b = in.read<int16_t>();
            switch (op) {
                case NullOp::NoteOn: timed.command.type = texed::CommandType::NoteOn; break;
                case NullOp::NoteOff: timed.command.type = texed::CommandType::NoteOff; break;
                case NullOp::Cc: timed.command.type = texed::CommandType::Cc; break;
                case NullOp::PitchBend: timed.command.type = texed::CommandType::PitchBend; break;
                case NullOp::Aftertouch: timed.command.type = texed::CommandType::Aftertouch; break;
                case NullOp::SetParam: timed.command.type = texed::CommandType::SetParam; break;
                case NullOp::SetSupplementParam:
                    timed.command.type = texed::CommandType::SetSupplementParam;
                    break;
                default: return fail("unknown event opcode in case file");
            }
            events.push_back(std::move(timed));
        }
        if (!in.ok()) return fail("truncated case file");

        size_t next = 0;
        for (int b = 0; b < blocks; b++) {
            while (next < events.size() && events[next].block <= b) {
                texed::applyCommand(rack, events[next].command);
                ++next;
            }
            rack.render(buffer.data(), buffer.data() + blockSize, blockSize);
            out->write(buffer.data(), buffer.size() * sizeof(float));
        }
    }
    std::printf("rendered %u null cases to %s\n", count, outFile.getFullPathName().toRawUTF8());
    return 0;
}

int renderScore(const juce::ArgumentList& args, const juce::File& outFile) {
    const auto secondsArg = valueFor(args, "--seconds");
    const double seconds = secondsArg.isNotEmpty() ? secondsArg.getDoubleValue() : 2.0;
    const auto scorePath = valueFor(args, "--commands");
    const auto score =
        scorePath.isEmpty()
            ? defaultScore()
            : readScore(juce::File::getCurrentWorkingDirectory().getChildFile(scorePath));

    texed::SynthRack rack(kSampleRate);

    const int64_t total = (int64_t)(seconds * kSampleRate);
    juce::AudioBuffer<float> out(2, (int)total);
    out.clear();

    size_t next = 0;
    for (int64_t at = 0; at < total; at += kBlockSize) {
        while (next < score.size() && score[next].sample <= at) {
            texed::applyCommand(rack, score[next].command);
            ++next;
        }
        const int n = (int)std::min<int64_t>(kBlockSize, total - at);
        rack.render(out.getWritePointer(0, (int)at), out.getWritePointer(1, (int)at), n);
    }

    const auto peakL = out.getMagnitude(0, 0, (int)total);
    const auto peakR = out.getMagnitude(1, 0, (int)total);
    const auto peak = juce::jmax(peakL, peakR);
    std::printf("peak %.6f (%.2f dBFS) over %.2fs, L %.6f R %.6f\n", peak,
                peak > 0 ? 20 * std::log10(peak) : -1000.0, seconds, peakL, peakR);

    outFile.deleteFile();
    juce::WavAudioFormat wav;
    std::unique_ptr<juce::FileOutputStream> stream(outFile.createOutputStream());
    if (stream == nullptr) return fail("cannot write " + outFile.getFullPathName());
    std::unique_ptr<juce::AudioFormatWriter> writer(
        wav.createWriterFor(stream.release(), kSampleRate, 2, 24, {}, 0));
    if (writer == nullptr) return fail("cannot encode WAV");
    writer->writeFromAudioSampleBuffer(out, 0, (int)total);
    return peak > 0 ? 0 : 1;
}

}  // namespace

int main(int argc, char** argv) {
    const juce::ArgumentList args(argc, argv);
    const auto cwd = juce::File::getCurrentWorkingDirectory();

    const auto casesPath = valueFor(args, "--null-cases");
    if (casesPath.isNotEmpty()) {
        const auto pcmPath = valueFor(args, "--out-pcm");
        if (pcmPath.isEmpty()) return usage();
        return renderNullCases(cwd.getChildFile(casesPath), cwd.getChildFile(pcmPath));
    }

    const auto outPath = valueFor(args, "--out");
    if (outPath.isEmpty()) return usage();
    return renderScore(args, cwd.getChildFile(outPath));
}
