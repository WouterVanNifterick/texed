import { describe, it, expect } from 'vitest';
import {
  acedToSupplement,
  acedToSysex,
  supplementToAced,
  ACED_UNPACKED_SIZE,
  AMEM_SLOT_SIZE,
} from '../amem';
import { identifyFrame, SysexKind } from '../sysex';

// A supplement slot with every field set to a distinct value, so a round trip
// through the ACED (unpacked) form has to preserve all of them.
function sampleSupplement(): Uint8Array {
  const a = new Uint8Array(AMEM_SLOT_SIZE);
  a[0] = 0b00101010; // scaling mode OP6/OP4/OP2 fractional
  a[1] = (5 << 3) | 2; // AMS OP5=5, OP6=2
  a[2] = (7 << 3) | 3;
  a[3] = (1 << 3) | 6;
  a[4] = (6 << 4) | (1 << 3) | (1 << 2) | 2; // RNDP=6 VPSW LTRG PEGR=2
  a[5] = (9 << 2) | 0b10 | 0b01; // PBR=9 unison mono
  a[6] = (2 << 4) | 11; // PBM=2 PBS=11
  a[7] = (12 << 1) | 1; // PQNT=12 PORM=1
  a[8] = 77; // portamento time
  // Controller ranges (0-99): mod/foot1/breath/at (9-23) and foot2/midi (26-33).
  for (let i = 9; i < 24; i++) a[i] = (i * 3) % 100;
  for (let i = 26; i < 34; i++) a[i] = (i * 3) % 100;
  a[24] = 5; // pitch EG rate scaling (0-7); a[25] stays 0 (reserved)
  a[34] = (5 & 0x07) | (1 << 3); // unison detune=5, FC1-as-CS1
  return a;
}

describe('ACED single dump (LM  8973AE)', () => {
  it('round-trips a supplement through the unpacked ACED body', () => {
    const a = sampleSupplement();
    const back = acedToSupplement(supplementToAced(a));
    expect(Array.from(back)).toEqual(Array.from(a));
  });

  it('produces a 49-byte unpacked body', () => {
    expect(supplementToAced(sampleSupplement()).length).toBe(ACED_UNPACKED_SIZE);
  });

  it('emits a valid, classifiable ACED frame with a correct checksum', () => {
    const frame = acedToSysex(sampleSupplement());
    expect(frame[0]).toBe(0xf0);
    expect(frame[frame.length - 1]).toBe(0xf7);
    const id = identifyFrame(frame);
    expect(id.kind).toBe(SysexKind.Aced);
    expect(id.checksumOk).toBe(true);
  });

  it('recovers the supplement from its own emitted frame body', () => {
    const a = sampleSupplement();
    const frame = acedToSysex(a);
    // Skip F0 43 00 7E <size hi> <size lo> and the 10-char "LM  8973AE" id.
    const body = frame.subarray(6 + 10, 6 + 10 + ACED_UNPACKED_SIZE);
    expect(Array.from(acedToSupplement(body))).toEqual(Array.from(a));
  });
});
