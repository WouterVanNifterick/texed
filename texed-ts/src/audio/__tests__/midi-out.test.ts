import { describe, it, expect, beforeEach } from 'vitest';
import {
  setMidiOutConnection,
  setMidiOutTarget,
  setMidiOutLive,
  emitVoiceParam,
  emitSupplement,
  sendVoiceDump,
} from '../midi-out';
import type { MidiConnection } from '../midi';
import { createDefaultAmem } from '@texed/dx7-format/amem';
import { identifyFrame, SysexKind } from '@texed/dx7-format/sysex';
import { initVoice } from '@texed/dx7-format/cartridge';

function fakeConn(): { conn: MidiConnection; sent: Uint8Array[] } {
  const sent: Uint8Array[] = [];
  const conn: MidiConnection = {
    close: () => {},
    setForwardOutput: () => {},
    send: (_id, data) => sent.push(data instanceof Uint8Array ? data : Uint8Array.from(data)),
  };
  return { conn, sent };
}

describe('midi-out emitter', () => {
  beforeEach(() => {
    // Reset the module singleton between tests.
    setMidiOutConnection(null);
    setMidiOutTarget('');
    setMidiOutLive(false);
  });

  it('emits an exact VCED parameter-change frame', () => {
    const { conn, sent } = fakeConn();
    setMidiOutConnection(conn);
    setMidiOutTarget('out-1');
    setMidiOutLive(true);

    emitVoiceParam(134, 5); // algorithm byte: offset 134 -> hi=1, lo=6
    expect(Array.from(sent[0])).toEqual([0xf0, 0x43, 0x10, 1, 6, 5, 0xf7]);
  });

  it('no-ops when live is off or no target is selected', () => {
    const { conn, sent } = fakeConn();
    setMidiOutConnection(conn);

    setMidiOutTarget('out-1');
    setMidiOutLive(false);
    emitVoiceParam(0, 1);
    expect(sent).toHaveLength(0);

    setMidiOutTarget('');
    setMidiOutLive(true);
    emitVoiceParam(0, 1);
    emitSupplement(createDefaultAmem());
    expect(sent).toHaveLength(0);
  });

  it('emits a classifiable ACED frame on supplement change', () => {
    const { conn, sent } = fakeConn();
    setMidiOutConnection(conn);
    setMidiOutTarget('out-1');
    setMidiOutLive(true);

    emitSupplement(createDefaultAmem());
    expect(identifyFrame(sent[0])).toMatchObject({ kind: SysexKind.Aced, checksumOk: true });
  });

  it('sends ACED then VCED for a manual voice dump regardless of the live flag', () => {
    const { conn, sent } = fakeConn();
    setMidiOutConnection(conn);
    setMidiOutTarget('out-1');
    setMidiOutLive(false);

    sendVoiceDump(initVoice(), createDefaultAmem());
    expect(sent).toHaveLength(2);
    expect(identifyFrame(sent[0]).kind).toBe(SysexKind.Aced);
    expect(identifyFrame(sent[1]).kind).toBe(SysexKind.Voice);
  });
});
