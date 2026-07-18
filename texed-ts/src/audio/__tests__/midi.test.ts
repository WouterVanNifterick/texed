import { describe, it, expect } from 'vitest';
import { shouldForwardMidi } from '../midi';

describe('shouldForwardMidi', () => {
  it('forwards channel voice messages', () => {
    expect(shouldForwardMidi([0x90, 60, 100])).toBe(true);
    expect(shouldForwardMidi([0x80, 60, 0])).toBe(true);
    expect(shouldForwardMidi([0xb0, 1, 64])).toBe(true);
  });

  it('forwards SysEx', () => {
    expect(shouldForwardMidi([0xf0, 0x43, 0x00, 0xf7])).toBe(true);
  });

  it('drops system real-time messages', () => {
    expect(shouldForwardMidi([0xf8])).toBe(false); // clock
    expect(shouldForwardMidi([0xfe])).toBe(false); // active sensing
    expect(shouldForwardMidi([0xff])).toBe(false); // reset
  });
});
