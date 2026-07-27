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

  it('maps the filter, reverb send and global reverb block', () => {
    const ini = `
Cutoff1=42
Resonance1=99
ReverbSend2=0
ReverbSize=80
CompressorEnable=0
UnknownKey=keep
`;
    const { parts, global, extras } = parseMiniDexedIni(ini);
    expect(parts[0]?.cutoff).toBeCloseTo(42 / 99);
    expect(parts[0]?.resonance).toBeCloseTo(1);
    expect(parts[1]?.reverbSend).toBe(0);
    expect(global.compressor).toBe(false);
    expect(global.reverb.enabled).toBe(true); // absent key, MiniDexed default
    expect(global.reverb.size).toBeCloseTo(80 / 99);
    expect(extras.unknown).toEqual([{ key: 'UnknownKey', value: 'keep' }]);
  });

  it('falls back to MiniDexed defaults for absent keys', () => {
    const { parts, global } = parseMiniDexedIni('MIDIChannel1=1\n');
    // Nothing to map, so parts stay untouched and the rack keeps its own values.
    expect(parts[0]?.cutoff).toBeUndefined();
    expect(global.compressor).toBe(true);
    expect(global.reverb.level).toBeCloseTo(1);
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
  it('round-trips mapped, preserved and unknown keys', () => {
    const source = `
# demo
Cutoff1=11
Resonance2=22
ReverbSend3=33
PitchBendRange4=7
ReverbSize=80
CompressorEnable=0
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
      global: parsed.global,
      extras: parsed.extras,
    });
    const again = parseMiniDexedIni(text);
    expect(again.parts[0]?.cutoff).toBeCloseTo(11 / 99);
    expect(again.parts[1]?.resonance).toBeCloseTo(22 / 99);
    expect(again.parts[2]?.reverbSend).toBeCloseTo(33 / 99);
    expect(again.extras.tg[3]?.PitchBendRange).toBe('7');
    expect(again.global.compressor).toBe(false);
    expect(again.global.reverb.size).toBeCloseTo(80 / 99);
    expect(again.extras.unknown).toEqual([{ key: 'Custom', value: '1' }]);
    expect(again.parts[0]).toMatchObject({ enabled: true, rxChannel: 1 });
  });

  it('writes VoiceData for all TGs', () => {
    const voice = initVoice();
    // A name byte: the only part of a voice where 0x7F is a legal value, so it
    // survives the clamp and appears nowhere else in an init voice.
    voice[145] = 0x7f;
    const text = serializeMiniDexedIni({
      parts: Array.from({ length: 8 }, (_, i) => defaultPartConfig(i === 0)),
      voices: Array.from({ length: 8 }, () => voice),
      global: parseMiniDexedIni('').global,
    });
    expect(text).toContain('VoiceData1=');
    expect(text).toContain(' 7F');
    const { voices } = parseMiniDexedIni(text);
    expect(voices[0]?.[145]).toBe(0x7f);
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
