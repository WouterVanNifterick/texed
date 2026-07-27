// Byte offsets into the 156-byte unpacked voice, and the init voice.
// Mirrors the offsets in dx7-format/src/voice.ts and cartridge.ts.

#pragma once

#include <cstdint>

namespace texed {

constexpr int kVoiceSize = 156;

namespace G {
constexpr int pitchEgRate = 126;   // 4 bytes
constexpr int pitchEgLevel = 130;  // 4 bytes
constexpr int algorithm = 134;     // 0-31, displayed 1-32
constexpr int feedback = 135;
constexpr int oscKeySync = 136;
constexpr int lfoSpeed = 137;
constexpr int lfoDelay = 138;
constexpr int lfoPmd = 139;
constexpr int lfoAmd = 140;
constexpr int transpose = 144;  // 0-48, 24 = C3
constexpr int name = 145;       // 10 chars
constexpr int opEnable = 155;   // bitmask, bit i = sysex op index i
}  // namespace G

/** The DX7's INIT VOICE, 156 bytes unpacked. */
const uint8_t* initVoice();

/** The 10-character name held in an unpacked voice, into an 11-byte buffer. */
void getVoiceName(const uint8_t* voice, char* out);

}  // namespace texed
