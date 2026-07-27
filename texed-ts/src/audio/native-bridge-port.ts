// SynthPort over the JUCE 8 WebView bridge: the same commands and events the
// AudioWorklet exchanges, carried by `window.__JUCE__.backend` instead of a
// MessagePort.
//
// The split of duties is not the worklet's. C++ owns the audio and every value
// a DAW can automate; a SynthHost here owns the voice library, the
// performances and all file parsing, and its rack is never rendered. So this
// port is not a pure transport: it fans a command out to both sides, turns the
// raw MIDI C++ could not read into commands the host can, and reconciles the
// host against parameter moves coming back from the plugin.
//
// JUCE's backend channel is JSON only, so the binary fields (voice dumps, bank
// SysEx, micro-tuning blobs) are base64-encoded on the way through. That
// encoding is confined to this file: neither the UI nor the protocol types know
// the bridge exists.

import { SynthRack } from '@texed/dx7-engine/synth-rack';
import { MsgType, type SynthCommand, type SynthEvent } from '@texed/synth-protocol/protocol';
import type { SynthPort } from '@texed/synth-protocol/port';
import { SynthHost } from './synth-host';

/** Event ids on the JUCE backend channel. */
const CMD_EVENT = 'texedCommand';
const SYNTH_EVENT = 'texedEvent';
const READY_EVENT = 'texedReady';

/** The slice of JUCE's injected object we use. Absent in a plain browser. */
interface JuceBackend {
  emitEvent(eventId: string, payload: unknown): void;
  addEventListener(eventId: string, fn: (payload: unknown) => void): unknown;
}

function backend(): JuceBackend | null {
  const juce = (globalThis as { __JUCE__?: { backend?: JuceBackend } }).__JUCE__;
  return juce?.backend ?? null;
}

/** True when the page is running inside the JUCE plugin's WebView. */
export function hasNativeBridge(): boolean {
  return backend() !== null;
}

/** Stand-in for a byte array in the JSON that crosses the bridge. */
interface BinaryTag {
  $b64: string;
}

function isBinaryTag(v: unknown): v is BinaryTag {
  return typeof v === 'object' && v !== null && typeof (v as BinaryTag).$b64 === 'string';
}

function toBase64(bytes: Uint8Array): string {
  // Chunked so a 4 KB bank dump does not blow the argument limit of apply().
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Deep copy with every byte array replaced by its base64 tag. */
function encode(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { $b64: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    const v = value as ArrayBufferView;
    return { $b64: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encode(v);
    return out;
  }
  return value;
}

/** Inverse of `encode`; byte arrays come back as Uint8Array. */
function decode(value: unknown): unknown {
  if (isBinaryTag(value)) return fromBase64(value.$b64);
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = decode(v);
    return out;
  }
  return value;
}

/**
 * Commands C++ acts on directly. Everything else concerns the librarian, and
 * reaches the plugin as the resolved voices and part configs it produces.
 */
const NATIVE_ONLY = new Set<string>([
  MsgType.NoteOn,
  MsgType.NoteOff,
  MsgType.Cc,
  MsgType.PitchBend,
  MsgType.Aftertouch,
  MsgType.Panic,
  MsgType.ParamGesture,
]);

/** One part's resolved state, as last pushed to the plugin. */
interface PartSnapshot {
  voice: string;
  supplement: string;
  config: string;
}

/**
 * The plugin exposes performances as host programs, which needs two messages
 * the worklet has no use for: the list on the way down, and the host's pick on
 * the way back up.
 */
interface SelectProgramMsg {
  type: 'selectProgram';
  index: number;
}
type NativeEvent = SynthEvent | SelectProgramMsg;

export class NativeBridgePort implements SynthPort {
  private listeners = new Set<(e: SynthEvent) => void>();
  private bound = false;
  /** Librarian: owns the library and the formats. Its rack is never rendered. */
  private host: SynthHost;
  private rack = new SynthRack(44100);
  private pushed: PartSnapshot[] = [];
  /** Set while reconciling against the plugin, so nothing echoes back to it. */
  private reconciling = false;

  constructor() {
    this.host = new SynthHost(this.rack, (event) => this.fromHost(event));
  }

  async start(): Promise<void> {
    const be = backend();
    if (!be) throw new Error('No JUCE bridge on this page');
    if (!this.bound) {
      be.addEventListener(SYNTH_EVENT, (payload) =>
        this.fromNative(decode(payload) as NativeEvent),
      );
      this.bound = true;
    }
    this.host.sendInitialState();
    // The plugin answers with its session snapshot, then the voices, parts and
    // settings its document and parameters hold.
    be.emitEvent(READY_EVENT, {});
  }

  /**
   * `transfer` is ignored: the bridge serializes, so there is nothing to hand
   * over. Callers already treat the buffers as gone, so we never read them again.
   */
  send(cmd: SynthCommand): void {
    if (NATIVE_ONLY.has(cmd.type)) return this.toNative(cmd);
    this.host.handle(cmd);
    this.pushResolved();
  }

  onEvent(cb: (e: SynthEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private toNative(cmd: SynthCommand | { type: 'programs'; names: string[]; index: number }): void {
    backend()?.emitEvent(CMD_EVENT, encode(cmd));
  }

  private emit(event: SynthEvent): void {
    for (const cb of this.listeners) cb(event);
  }

  private fromHost(event: SynthEvent): void {
    // The host's program list, whatever changed it: a library load, a .ini, or
    // the plugin asking for one of them.
    if (event.type === 'performances') {
      this.toNative({ type: 'programs', names: event.names, index: event.index });
    }
    if (this.reconciling) return;
    this.emit(event);
  }

  /** Run `apply` against the librarian without echoing anything back. */
  private quietly(apply: () => void): void {
    this.reconciling = true;
    try {
      apply();
    } finally {
      this.reconciling = false;
    }
  }

  private fromNative(event: NativeEvent): void {
    switch (event.type) {
      case 'selectProgram':
        // The host picked a performance. Only the librarian can resolve one,
        // so it runs here and the result goes back down as voices and parts.
        this.host.handle({ type: MsgType.SelectPerformance, index: event.index });
        this.pushResolved();
        return;
      case 'midi':
        // Bytes the plugin could not read on its own: a bulk dump, a program
        // change or a bank select, all of which need the library.
        this.handleForwardedMidi(event.data);
        return;
      case 'fullState':
        // The session snapshot, handed back when the editor reconnects. The
        // librarian owns it, so let its events through.
        this.host.handle({ type: MsgType.SetFullState, state: event.state });
        this.markPushed();
        return;
      case 'parts':
        this.quietly(() => {
          for (const [i, config] of event.configs.entries()) {
            this.host.handle({ type: MsgType.SetPart, index: i, config });
          }
        });
        break;
      case 'settings':
        this.quietly(() => {
          this.host.handle({ type: MsgType.SetGlobal, settings: event.settings });
        });
        break;
      case 'voice':
        this.quietly(() => {
          this.host.handle({
            type: MsgType.LoadVoice,
            data: event.data.buffer as ArrayBuffer,
            supplement: event.supplement.buffer as ArrayBuffer,
          });
        });
        break;
    }
    this.markPushed();
    this.emit(event);
  }

  private handleForwardedMidi(data: Uint8Array): void {
    if (data[0] === 0xf0) {
      this.host.handle({ type: MsgType.Sysex, data: data.buffer as ArrayBuffer });
    } else if ((data[0] & 0xf0) === 0xc0) {
      this.host.handle({
        type: MsgType.ProgramChange,
        program: data[1],
        channel: (data[0] & 0x0f) + 1,
      });
    } else if ((data[0] & 0xf0) === 0xb0) {
      this.host.handle({
        type: MsgType.Cc,
        controller: data[1],
        value: data[2],
        channel: (data[0] & 0x0f) + 1,
      });
    }
    this.pushResolved();
  }

  private snapshot(index: number): PartSnapshot {
    return {
      voice: String(this.rack.getVoiceData(index)),
      supplement: String(this.rack.getSupplementData(index)),
      config: JSON.stringify(this.rack.getPartConfig(index)),
    };
  }

  /** Accept the librarian's current state as already known to the plugin. */
  private markPushed(): void {
    this.pushed = Array.from({ length: this.rack.getPartConfigs().length }, (_, i) =>
      this.snapshot(i),
    );
  }

  /**
   * Send the plugin whatever the librarian resolved: voices as bytes, part
   * configs as patches. Diffed, so a command that changed one part does not
   * rewrite the other seven, and so a value that came from the plugin in the
   * first place is not sent straight back.
   */
  private pushResolved(): void {
    let libraryChanged = false;
    const configs = this.rack.getPartConfigs();
    for (let i = 0; i < configs.length; i++) {
      const now = this.snapshot(i);
      const before = this.pushed[i];
      if (before?.voice !== now.voice || before?.supplement !== now.supplement) {
        this.toNative({
          type: MsgType.LoadVoice,
          data: this.rack.getVoiceData(i).buffer as ArrayBuffer,
          supplement: this.rack.getSupplementData(i).buffer as ArrayBuffer,
          partIndex: i,
        });
        libraryChanged = true;
      }
      if (before?.config !== now.config) {
        this.toNative({ type: MsgType.SetPart, index: i, config: configs[i] });
        libraryChanged = true;
      }
      this.pushed[i] = now;
    }
    if (libraryChanged) this.saveSnapshot();
  }

  /**
   * Hand the plugin the library, performances and micro-tunings to persist. It
   * keeps them opaque and gives them straight back when the editor reconnects.
   */
  private saveSnapshot(): void {
    this.toNative({ type: MsgType.SetFullState, state: this.rack.getFullState() });
  }
}
