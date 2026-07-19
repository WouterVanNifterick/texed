// A SynthPort is one end of the control protocol: hosts talk to a synth
// exclusively through this interface. Implementations: WorkletPort (local TS
// engine in an AudioWorklet), a hardware MIDI port (SysEx to a real
// DX7/TX802), or a native bridge (JUCE WebView -> C++ engine).

import type { SynthCommand, SynthEvent } from './protocol';

export interface SynthPort {
  /** Bring the transport up; idempotent, resolves once commands can flow. */
  start(): Promise<void>;
  /** Fire-and-forget command. `transfer` lists buffers to move rather than copy,
   * where the transport supports it. */
  send(cmd: SynthCommand, transfer?: ArrayBuffer[]): void;
  /** Subscribe to events coming back from the synth; returns unsubscribe. */
  onEvent(cb: (e: SynthEvent) => void): () => void;
}
