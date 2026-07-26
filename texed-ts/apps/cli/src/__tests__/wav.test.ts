import { describe, expect, it } from 'vitest';
import { encodeWavStereo16 } from '../wav';

const SAMPLE_RATE = 44100;

function ascii(wav: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...wav.subarray(offset, offset + length));
}

function view(wav: Uint8Array): DataView {
  return new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
}

describe('encodeWavStereo16', () => {
  it('writes a 44-byte canonical PCM header', () => {
    const wav = encodeWavStereo16(new Float32Array(2), new Float32Array(2), SAMPLE_RATE);
    const v = view(wav);

    expect(wav.length).toBe(44 + 2 * 4);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2); // stereo
    expect(v.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(v.getUint32(28, true)).toBe(SAMPLE_RATE * 4); // byte rate
    expect(v.getUint16(32, true)).toBe(4); // block align
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(2 * 4);
  });

  it('interleaves the channels and clamps out-of-range samples', () => {
    const wav = encodeWavStereo16(
      new Float32Array([0, 1.5]),
      new Float32Array([-1.5, -0.5]),
      SAMPLE_RATE,
    );
    const v = view(wav);

    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(-32767);
    expect(v.getInt16(48, true)).toBe(32767);
    expect(v.getInt16(50, true)).toBe(-16383);
  });
});
