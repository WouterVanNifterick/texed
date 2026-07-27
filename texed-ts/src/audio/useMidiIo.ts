// Web MIDI wiring: device discovery, the outgoing target, and the two mirroring
// modes (live per-parameter changes and debounced full voice dumps).

import { useCallback, useEffect, useState } from 'react';
import { usePersistentFlag, usePersistentState } from '../hooks';
import { trackCc, trackAftertouch } from '../state/live-ctrl';
import { initMidi, type MidiConnection } from './midi';
import { setMidiOutConnection, setMidiOutTarget, setMidiOutLive, sendVoiceDump } from './midi-out';
import type { Synth } from './useSynth';

/** How long edits must settle before the full voice dump goes out. */
const AUTO_SEND_DEBOUNCE_MS = 250;

export interface MidiIo {
  inputs: string[];
  outputs: { id: string; name: string }[];
  outId: string;
  setOutId: (id: string) => void;
  live: boolean;
  setLive: (on: boolean) => void;
  autoSend: boolean;
  setAutoSend: (on: boolean) => void;
  /** Transmit the current voice now (manual SEND). */
  sendVoice: () => void;
  /** Open Web MIDI and route input into the synth. Call once, on start. */
  connect: () => Promise<MidiConnection | null>;
}

export interface MidiIoOptions {
  synth: Synth;
  noteOn: (note: number, velocity: number, channel?: number) => void;
  noteOff: (note: number, channel?: number) => void;
  /**
   * Hardware editor mode. Every edit already streams out through the hardware
   * port, so the live mirror and auto-send would duplicate each frame.
   */
  hardwareMode: boolean;
}

export function useMidiIo({ synth, noteOn, noteOff, hardwareMode }: MidiIoOptions): MidiIo {
  const [inputs, setInputs] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<{ id: string; name: string }[]>([]);
  const [outId, setOutId] = usePersistentState<string>('midiOutId', '');
  const [live, setLive] = usePersistentFlag('midiLiveSend', false);
  const [autoSend, setAutoSend] = usePersistentFlag('midiAutoSend', false);

  const connect = useCallback(async () => {
    let conn: MidiConnection | null = null;
    try {
      conn = await initMidi({
        noteOn,
        noteOff,
        controlChange: (controller, value, channel) => {
          trackCc(controller, value);
          synth.controlChange(controller, value, channel);
        },
        programChange: synth.programChange,
        sysex: synth.sysex,
        pitchBend: synth.pitchBend,
        aftertouch: (value, channel) => {
          trackAftertouch(value);
          synth.aftertouch(value, channel);
        },
        inputsChanged: setInputs,
        outputsChanged: setOutputs,
      });
    } catch {
      // No Web MIDI (denied, unsupported, or no devices). The on-screen and
      // QWERTY keyboards still work, so this is not worth interrupting start.
    }
    // Route all outgoing SysEx (voice dumps, live param changes) and note
    // forwarding through this connection, restoring the persisted target/toggle.
    setMidiOutConnection(conn);
    setMidiOutTarget(outId);
    setMidiOutLive(!hardwareMode && live);
    return conn;
  }, [synth, noteOn, noteOff, outId, live, hardwareMode]);

  useEffect(() => {
    setMidiOutTarget(outId);
  }, [outId]);

  useEffect(() => {
    setMidiOutLive(!hardwareMode && live);
  }, [live, hardwareMode]);

  const sendVoice = useCallback(() => {
    sendVoiceDump(synth.voice, synth.supplement);
  }, [synth]);

  // Each new voice/supplement reference restarts the timer (cleanup = debounce),
  // so a slider drag sends once rather than per frame.
  useEffect(() => {
    if (hardwareMode || !autoSend || !outId) return;
    const t = setTimeout(() => sendVoiceDump(synth.voice, synth.supplement), AUTO_SEND_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [autoSend, outId, hardwareMode, synth.voice, synth.supplement]);

  return {
    inputs,
    outputs,
    outId,
    setOutId,
    live,
    setLive,
    autoSend,
    setAutoSend,
    sendVoice,
    connect,
  };
}
