import { describe, it, expect } from 'vitest';
import { HardwareMidiPort } from '../hardware-midi-port';
import { MsgType, type SynthEvent } from '@texed/synth-protocol/protocol';
import { identifyFrame, SysexKind } from '@texed/dx7-format/sysex';
import { initVoice } from '@texed/dx7-format/cartridge';
import { createDefaultAmem } from '@texed/dx7-format/amem';
import { NUM_PARTS } from '@texed/dx7-format/part-config';
import type { MidiConnection } from '../midi';

function wired() {
  const sent: Uint8Array[] = [];
  const conn: MidiConnection = {
    close: () => {},
    setForwardOutput: () => {},
    send: (_id, data) => sent.push(data instanceof Uint8Array ? data : Uint8Array.from(data)),
  };
  const events: SynthEvent[] = [];
  const port = new HardwareMidiPort();
  port.setConnection(conn);
  port.setTarget('out-1');
  port.onEvent((e) => events.push(e));
  return { port, sent, events };
}

describe('HardwareMidiPort', () => {
  it('translates channel commands to raw MIDI bytes', () => {
    const { port, sent } = wired();
    port.send({ type: MsgType.NoteOn, note: 60, velocity: 100, channel: 1 });
    port.send({ type: MsgType.NoteOff, note: 60, channel: 2 });
    port.send({ type: MsgType.Cc, controller: 1, value: 64, channel: 1 });
    port.send({ type: MsgType.PitchBend, value: 8192 });
    port.send({ type: MsgType.Aftertouch, value: 30 });
    expect(sent.map((m) => Array.from(m))).toEqual([
      [0x90, 60, 100],
      [0x81, 60, 0x40],
      [0xb0, 1, 64],
      [0xe0, 0, 64],
      [0xd0, 30],
    ]);
  });

  it('sends an exact VCED parameter-change frame for SetParam', () => {
    const { port, sent } = wired();
    port.send({ type: MsgType.SetParam, offset: 134, value: 5 }); // algorithm: hi=1, lo=6
    expect(Array.from(sent[0])).toEqual([0xf0, 0x43, 0x10, 1, 6, 5, 0xf7]);
  });

  it('re-sends a checksummed ACED dump for SetSupplementParam', () => {
    const { port, sent } = wired();
    port.send({ type: MsgType.SetSupplementParam, offset: 8, value: 50 });
    expect(identifyFrame(sent[0])).toMatchObject({ kind: SysexKind.Aced, checksumOk: true });
  });

  it('LoadVoice dumps ACED then VCED and mirrors a voice event', () => {
    const { port, sent, events } = wired();
    const voice = initVoice();
    port.send({
      type: MsgType.LoadVoice,
      data: voice.slice().buffer as ArrayBuffer,
      supplement: createDefaultAmem().slice().buffer as ArrayBuffer,
    });
    expect(identifyFrame(sent[0]).kind).toBe(SysexKind.Aced);
    expect(identifyFrame(sent[1]).kind).toBe(SysexKind.Voice);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'voice' });
  });

  it('start() seeds a default editable state for the UI', async () => {
    const { port, events } = wired();
    await port.start();
    expect(events.map((e) => e.type)).toEqual(['voice', 'parts', 'programState', 'masterTune']);
    const parts = events[1];
    if (parts.type !== 'parts') throw new Error('expected parts event');
    expect(parts.configs).toHaveLength(NUM_PARTS);
    expect(parts.configs[0].enabled).toBe(true);
  });

  it('sends all-notes-off on every channel for Panic', () => {
    const { port, sent } = wired();
    port.send({ type: MsgType.Panic });
    expect(sent).toHaveLength(16);
    expect(Array.from(sent[15])).toEqual([0xbf, 123, 0]);
  });

  it('no-ops without a configured target', () => {
    const { port, sent } = wired();
    port.setTarget('');
    port.send({ type: MsgType.NoteOn, note: 60, velocity: 100, channel: 1 });
    expect(sent).toHaveLength(0);
  });
});
