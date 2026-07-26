import { describe, expect, it } from 'vitest';
import { noteName, formatTranspose } from '@texed/dx7-format/params';

describe('noteName', () => {
  it('maps MIDI notes to scientific pitch names', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(0)).toBe('C-1');
    expect(noteName(127)).toBe('G9');
    expect(noteName(69)).toBe('A4');
  });
});

describe('formatTranspose', () => {
  it('reads the stored semitone count as a note name', () => {
    expect(formatTranspose(0)).toBe('C1');
    expect(formatTranspose(24)).toBe('C3');
    expect(formatTranspose(48)).toBe('C5');
  });
});
