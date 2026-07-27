import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  splitSysex,
  identifySysex,
  identifyFrame,
  SysexKind,
  voiceFromVced,
  voiceFromRawVced,
  vcedFromVoice,
  voiceParamChangeSysex,
  parseParamChange,
  parseMasterVolume,
  ParamGroup,
  cartridgeFromSyx,
  cartridgeFromVoices,
} from '@texed/dx7-format/sysex';
import { isFillerVoiceName } from '@texed/dx7-format/voice';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string): Uint8Array => new Uint8Array(readFileSync(join(here, 'fixtures', name)));

describe('splitSysex', () => {
  it('splits a concatenated file into individual F0..F7 frames', () => {
    const frames = splitSysex(fx('tx802-prg1.syx'));
    // param-change + format-6 performance + 32-voice VMEM
    expect(frames.length).toBe(3);
    for (const f of frames) {
      expect(f[0]).toBe(0xf0);
      expect(f[f.length - 1]).toBe(0xf7);
    }
  });

  it('returns a single frame for a plain cartridge', () => {
    expect(splitSysex(fx('rom1a.syx')).length).toBe(1);
  });
});

describe('identifySysex - golden fixtures', () => {
  it('recognizes a 32-voice VMEM cartridge', () => {
    const [frame] = identifySysex(fx('rom1a.syx'));
    expect(frame.kind).toBe(SysexKind.Cartridge);
    expect(frame.format).toBe(0x09);
    expect(frame.checksumOk).toBe(true);
  });

  it('recognizes a DX7II performance memory (LM  8973PM)', () => {
    const [frame] = identifySysex(fx('dx7ii-perf.syx'));
    expect(frame.kind).toBe(SysexKind.Dx7iiPerformance);
    expect(frame.formatId).toBe('LM  8973PM');
    expect(frame.checksumOk).toBe(true);
  });

  it('recognizes a DX5/DX1 performance memory (format 2)', () => {
    // Note: DX1/DX5 format-2 dumps use a different checksum convention than
    // the DX7 family, so only identification is asserted here.
    const [frame] = identifySysex(fx('dx5-perf.syx'));
    expect(frame.kind).toBe(SysexKind.Dx5Performance);
    expect(frame.format).toBe(0x02);
  });

  it('recognizes a TX802 bank file as param-change + AMEM + cartridge', () => {
    const frames = identifySysex(fx('tx802-prg1.syx'));
    expect(frames.map((f) => f.kind)).toEqual([
      SysexKind.ParamChange,
      SysexKind.Amem,
      SysexKind.Cartridge,
    ]);
    expect(frames[1].format).toBe(0x06);
    expect(frames[1].checksumOk).toBe(true);
    expect(frames[2].checksumOk).toBe(true);
  });

  it('recognizes DX7II cartridge fractional-scaling blocks', () => {
    const frames = identifySysex(fx('dx7ii-cart.syx'));
    expect(frames[0].kind).toBe(SysexKind.ParamChange);
    const scale = frames.filter((f) => f.kind === SysexKind.FractionalScale);
    expect(scale.length).toBeGreaterThan(0);
    expect(scale[0].formatId?.startsWith('LM  FKS')).toBe(true);
  });
});

describe('VCED round-trip', () => {
  it('serializes and parses a voice back byte-for-byte', () => {
    const cart = cartridgeFromSyx(fx('rom1a.syx'))!;
    const voice = cart.unpackProgram(0);
    const vced = vcedFromVoice(voice);
    expect(vced.length).toBe(163);
    expect(identifyFrame(vced).kind).toBe(SysexKind.Voice);
    expect(identifyFrame(vced).checksumOk).toBe(true);
    const back = voiceFromVced(vced)!;
    expect(Array.from(back)).toEqual(Array.from(voice));
  });
});

describe('voice clamping', () => {
  it('pulls out-of-range bytes back to the DX7 maxima', () => {
    const raw = new Uint8Array(155).fill(0x7f);
    const voice = voiceFromRawVced(raw)!;
    expect(voice[0]).toBe(99); // EG rate
    expect(voice[11]).toBe(3); // scaling curve
    expect(voice[13]).toBe(7); // rate scaling
    expect(voice[18]).toBe(31); // coarse frequency
    expect(voice[20]).toBe(14); // detune
    expect(voice[134]).toBe(31); // algorithm
    expect(voice[142]).toBe(5); // LFO waveform
    expect(voice[144]).toBe(48); // transpose
    expect(voice[145]).toBe(127); // name bytes stay printable ASCII
    expect(voice[155]).toBe(0x3f);
  });

  it('leaves a real cartridge voice untouched', () => {
    const cart = cartridgeFromSyx(fx('rom1a.syx'))!;
    const before = cart.unpackProgram(0);
    const after = voiceFromRawVced(before)!;
    expect(Array.from(after)).toEqual(Array.from(before));
  });
});

describe('isFillerVoiceName', () => {
  it('recognizes the usual bank padding', () => {
    for (const n of ['', '   ', 'EMPTY', 'empty', '----------', '~~~~~~~~~~', '**********']) {
      expect(isFillerVoiceName(n)).toBe(true);
    }
  });

  it('leaves real names alone', () => {
    for (const n of ['E.PIANO 1', 'BRASS   1', 'X', 'TUB BELLS']) {
      expect(isFillerVoiceName(n)).toBe(false);
    }
  });
});

describe('live sysex frames', () => {
  it('round-trips a voice parameter change', () => {
    const frame = voiceParamChangeSysex(134, 42, 3);
    expect(parseParamChange(frame)).toEqual({
      device: 3,
      group: ParamGroup.VoiceHigh,
      param: 6,
      value: 42,
    });
  });

  it('is not fooled by a bulk dump header', () => {
    expect(parseParamChange(fx('rom1a.syx'))).toBeNull();
  });

  it('decodes universal master volume into a 0..1 gain', () => {
    const full = Uint8Array.of(0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x7f, 0x7f, 0xf7);
    expect(parseMasterVolume(full)).toBe(1);
    const off = Uint8Array.of(0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x00, 0x00, 0xf7);
    expect(parseMasterVolume(off)).toBe(0);
    expect(parseMasterVolume(voiceParamChangeSysex(0, 0))).toBeNull();
  });
});

describe('VMEM pack/unpack round-trip', () => {
  it('repacks 32 unpacked voices to the original packed bytes', () => {
    const original = cartridgeFromSyx(fx('rom1a.syx'))!;
    const voices = Array.from({ length: 32 }, (_, i) => original.unpackProgram(i));
    const repacked = cartridgeFromVoices(voices);
    // Compare the packed voice region (6 .. 6+4096) byte-for-byte.
    const a = original.voiceData.subarray(6, 6 + 4096);
    const b = repacked.voiceData.subarray(6, 6 + 4096);
    expect(Array.from(b)).toEqual(Array.from(a));
    // ...and the recomputed checksum matches the original dump.
    expect(repacked.voiceData[6 + 4096]).toBe(original.voiceData[6 + 4096]);
  });

  it('preserves program names through pack/unpack', () => {
    const original = cartridgeFromSyx(fx('rom1a.syx'))!;
    const voices = Array.from({ length: 32 }, (_, i) => original.unpackProgram(i));
    const repacked = cartridgeFromVoices(voices);
    expect(repacked.programNames()).toEqual(original.programNames());
  });
});
