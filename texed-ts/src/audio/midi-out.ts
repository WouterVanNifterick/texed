// Single MIDI-out sink: centralizes every outgoing SysEx (manual voice dump,
// live VCED/ACED parameter changes) and the forward target. Web MIDI output is
// inherently one device, so this is a module singleton. All emitters no-op until
// a connection + target are configured, so the disabled path costs one branch.

import { voiceToSysex } from '@texed/dx7-format/params';
import { acedToSysex } from '@texed/dx7-format/amem';
import { voiceParamChangeSysex } from '@texed/dx7-format/sysex';
import { HardwareMidiPort } from './hardware-midi-port';
import type { MidiConnection } from './midi';

/** Hardware editing port (?hw mode): pass to useDexedSynth to edit a hardware
 * synth instead of the local engine. Bound to the same connection and output
 * target as the live mirror below, so the settings UI drives both. */
export const hardwarePort = new HardwareMidiPort();

let conn: MidiConnection | null = null;
let outId = '';
let live = false;

export function setMidiOutConnection(c: MidiConnection | null): void {
  conn = c;
  hardwarePort.setConnection(c);
  conn?.setForwardOutput(outId || null);
}

export function setMidiOutTarget(id: string): void {
  outId = id;
  hardwarePort.setTarget(id);
  conn?.setForwardOutput(id || null);
}

export function setMidiOutLive(on: boolean): void {
  live = on;
}

function send(bytes: Uint8Array | number[]): void {
  if (outId) conn?.send(outId, bytes);
}

/** Manual SEND: transmit the current voice as an ACED dump followed by a VCED dump. */
export function sendVoiceDump(voice: Uint8Array, supplement: Uint8Array): void {
  if (!outId || !conn) return;
  send(acedToSysex(supplement));
  send(voiceToSysex(voice));
}

/** Live VCED single-parameter change (offset 0-155 into the 156-byte voice). */
export function emitVoiceParam(offset: number, value: number): void {
  if (!live || !outId) return;
  send(voiceParamChangeSysex(offset, value));
}

/** Live ACED change: re-send the (already-patched) 35-byte supplement as an ACED dump. */
export function emitSupplement(supplement: Uint8Array): void {
  if (!live || !outId) return;
  send(acedToSysex(supplement));
}
