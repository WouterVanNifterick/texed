#include "voice.h"

namespace texed {

namespace {

// 155 bytes of INIT VOICE, then the op on/off byte at 155.
const uint8_t kInitVoice[kVoiceSize] = {
    99, 99, 99, 99, 99, 99, 99, 0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  1,  0,  7,   //
    99, 99, 99, 99, 99, 99, 99, 0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  1,  0,  7,   //
    99, 99, 99, 99, 99, 99, 99, 0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  1,  0,  7,   //
    99, 99, 99, 99, 99, 99, 99, 0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  1,  0,  7,   //
    99, 99, 99, 99, 99, 99, 99, 0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  1,  0,  7,   //
    99, 99, 99, 99, 99, 99, 99, 0,  0,  0,  0,  0,  0,  0,  0,  0,  99, 0,  1,  0,  7,   //
    99, 99, 99, 99, 50, 50, 50, 50, 0,  0,  1,  35, 0,  0,  0,  1,  0,  3,  24,          //
    'I', 'N', 'I', 'T', ' ', 'V', 'O', 'I', 'C', 'E',                                    //
    0x3f};

}  // namespace

const uint8_t* initVoice() {
    return kInitVoice;
}

void getVoiceName(const uint8_t* voice, char* out) {
    for (int i = 0; i < 10; i++) {
        const uint8_t c = voice[G::name + i];
        // The DX7 charset is ASCII in this range; anything else was never text.
        out[i] = (c >= 32 && c < 127) ? (char)c : ' ';
    }
    out[10] = '\0';
}

}  // namespace texed
