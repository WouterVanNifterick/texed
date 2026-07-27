import { describe, expect, it } from 'vitest';
import { parseSmf } from '../smf';

const DIVISION = 96; // ticks per quarter note

function chars(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/** Variable-length quantity, as SMF delta times are encoded. */
function vlq(n: number): number[] {
  const out = [n & 0x7f];
  for (let v = n >> 7; v > 0; v >>= 7) out.unshift((v & 0x7f) | 0x80);
  return out;
}

function be32(n: number): number[] {
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** One-track SMF from a flat track body, with the header and length filled in. */
function smf(body: number[], division = DIVISION): Uint8Array {
  return new Uint8Array([
    ...chars('MThd'),
    ...be32(6),
    0,
    0, // format 0
    0,
    1, // one track
    (division >> 8) & 0xff,
    division & 0xff,
    ...chars('MTrk'),
    ...be32(body.length),
    ...body,
  ]);
}

const TEMPO_1S_PER_QUARTER = [...vlq(0), 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40]; // 1,000,000 us
const END_OF_TRACK = [...vlq(0), 0xff, 0x2f, 0x00];

describe('parseSmf', () => {
  it('applies the tempo map and resolves running status', () => {
    const events = parseSmf(
      smf([
        ...TEMPO_1S_PER_QUARTER,
        ...vlq(0),
        0x90,
        60,
        100,
        // Running status: no status byte, and velocity 0 means note off.
        ...vlq(DIVISION),
        60,
        0,
        ...vlq(DIVISION),
        0xb0,
        7,
        127,
        ...END_OF_TRACK,
      ]),
    );

    expect(events).toEqual([
      { time: 0, kind: 'noteOn', channel: 1, a: 60, b: 100 },
      { time: 1, kind: 'noteOff', channel: 1, a: 60, b: 0 },
      { time: 2, kind: 'cc', channel: 1, a: 7, b: 127 },
    ]);
  });

  it('reads one-byte channel messages and the channel number', () => {
    const events = parseSmf(
      smf([
        ...vlq(0),
        0xc4,
        7, // program change, channel 5
        ...vlq(0),
        0xd4,
        64, // aftertouch, channel 5
        ...vlq(0),
        0xe0,
        0,
        64, // pitch bend, channel 1
        ...END_OF_TRACK,
      ]),
    );

    expect(events.map((e) => [e.kind, e.channel, e.a, e.b])).toEqual([
      ['program', 5, 7, 0],
      ['aftertouch', 5, 64, 0],
      ['pitchBend', 1, 0, 64],
    ]);
  });

  it('skips SysEx payloads', () => {
    const events = parseSmf(
      smf([
        ...vlq(0),
        0xf0,
        ...vlq(3),
        0x43,
        0x00,
        0xf7,
        ...vlq(0),
        0x90,
        60,
        100,
        ...END_OF_TRACK,
      ]),
    );

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('noteOn');
  });

  it('rejects files it cannot drive the rack from', () => {
    expect(() => parseSmf(new Uint8Array(16))).toThrow(/MThd/);
    // Bit 15 of the division marks SMPTE timecode instead of ticks per quarter.
    expect(() => parseSmf(smf(END_OF_TRACK, 0xe878))).toThrow(/SMPTE/);
  });
});
