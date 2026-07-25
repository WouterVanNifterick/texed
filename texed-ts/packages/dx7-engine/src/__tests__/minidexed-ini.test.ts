import { describe, it, expect } from 'vitest';
import { initVoice } from '@texed/dx7-format/cartridge';
import { defaultPartConfig } from '@texed/dx7-format/part-config';
import {
  decodeVoiceDataHex,
  encodeVoiceDataHex,
  parseMiniDexedIni,
  serializeMiniDexedIni,
} from '@texed/dx7-format/minidexed-ini';
import { SynthRack } from '../synth-rack';

describe('minidexed-ini VoiceData hex', () => {
  it('round-trips 156-byte voice', () => {
    const voice = initVoice();
    voice[0] = 0x5f;
    voice[155] = 0x3f;
    const hex = encodeVoiceDataHex(voice);
    const back = decodeVoiceDataHex(hex);
    expect(back).not.toBeNull();
    expect(back!.length).toBe(156);
    expect(back![0]).toBe(0x5f);
    expect(back![155]).toBe(0x3f);
  });
});

describe('parseMiniDexedIni', () => {
  it('maps MIDI channel off and omni', () => {
    const ini = `
MIDIChannel1=0
MIDIChannel2=255
MIDIChannel3=5
`;
    const { parts } = parseMiniDexedIni(ini);
    expect(parts[0]).toMatchObject({ enabled: false });
    expect(parts[1]).toMatchObject({ enabled: true, rxChannel: 0 });
    expect(parts[2]).toMatchObject({ enabled: true, rxChannel: 5 });
  });

  it('maps volume and pan', () => {
    const ini = `Volume1=127\nPan1=64\nPan2=0\nPan3=127\n`;
    const { parts } = parseMiniDexedIni(ini);
    expect(parts[0]?.volume).toBeCloseTo(1);
    expect(parts[0]?.pan).toBeCloseTo(0);
    expect(parts[1]?.pan).toBeCloseTo(-1);
    expect(parts[2]?.pan).toBeCloseTo(63 / 64);
  });

  it('preserves Cutoff and global reverb keys', () => {
    const ini = `
Cutoff1=42
ReverbSize=80
UnknownKey=keep
`;
    const { extras } = parseMiniDexedIni(ini);
    expect(extras.tg[0]?.Cutoff).toBe('42');
    expect(extras.global.ReverbSize).toBe('80');
    expect(extras.unknown).toEqual([{ key: 'UnknownKey', value: 'keep' }]);
  });

  it('reads the top-level Name attribute', () => {
    const ini = `
Name=ENSEMBLE [L] / SOLO VIOLIN [R]
Category=Converted
MIDIChannel1=1
`;
    const { name, extras } = parseMiniDexedIni(ini);
    expect(name).toBe('ENSEMBLE [L] / SOLO VIOLIN [R]');
    expect(extras.unknown).toEqual([{ key: 'Category', value: 'Converted' }]);
  });

  it('returns null name when Name is absent', () => {
    expect(parseMiniDexedIni('MIDIChannel1=1\n').name).toBeNull();
  });
});

describe('serializeMiniDexedIni round-trip', () => {
  it('keeps preserved keys and unknown keys', () => {
    const source = `
# demo
Cutoff1=11
Resonance2=22
ReverbSend3=33
Custom=1
MIDIChannel1=1
Volume1=100
Pan1=64
`;
    const parsed = parseMiniDexedIni(source);
    const parts = Array.from({ length: 8 }, (_, i) => ({
      ...defaultPartConfig(i === 0),
      ...parsed.parts[i],
    }));
    const voices = Array.from({ length: 8 }, () => initVoice());
    const text = serializeMiniDexedIni({
      parts,
      voices,
      extras: parsed.extras,
    });
    const again = parseMiniDexedIni(text);
    expect(again.extras.tg[0]?.Cutoff).toBe('11');
    expect(again.extras.tg[1]?.Resonance).toBe('22');
    expect(again.extras.tg[2]?.ReverbSend).toBe('33');
    expect(again.extras.unknown).toEqual([{ key: 'Custom', value: '1' }]);
    expect(again.parts[0]).toMatchObject({ enabled: true, rxChannel: 1 });
  });

  it('writes VoiceData for all TGs', () => {
    const voice = initVoice();
    voice[10] = 0xab;
    const text = serializeMiniDexedIni({
      parts: Array.from({ length: 8 }, (_, i) => defaultPartConfig(i === 0)),
      voices: Array.from({ length: 8 }, () => voice),
    });
    expect(text).toContain('VoiceData1=');
    expect(text).toContain(' AB');
    const { voices } = parseMiniDexedIni(text);
    expect(voices[0]?.[10]).toBe(0xab);
  });
});

describe('SynthRack.loadPerformance (unified .ini load path)', () => {
  it('populates edit buffers, sets the performance name, and marks it non-library', () => {
    const voice = initVoice();
    voice[0] = 0x2a;
    const ini = `MIDIChannel1=1\nVolume1=100\nVoiceData1=${encodeVoiceDataHex(voice)}\n`;
    const { parts, voices } = parseMiniDexedIni(ini);

    const rack = new SynthRack(44100);
    rack.loadPerformance('My Perf', parts, voices);

    const perf = rack.getPerformanceState();
    expect(perf.name).toBe('My Perf');
    expect(perf.index).toBe(-1); // not a library performance
    // Voice bytes landed directly in part 0's edit buffer.
    expect(rack.getVoiceData(0)[0]).toBe(0x2a);
  });
});
