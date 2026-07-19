// SynthPort that edits a hardware DX7/DX7II/TX802 over Web MIDI: protocol
// commands become channel messages and VCED/ACED SysEx instead of driving the
// local engine. The port keeps a local edit buffer so single-parameter
// commands can be re-sent as full dumps where the wire format needs one.

import { MsgType, type SynthCommand, type SynthEvent } from '@texed/synth-protocol/protocol';
import type { SynthPort } from '@texed/synth-protocol/port';
import { voiceParamChangeSysex } from '@texed/dx7-format/sysex';
import { voiceToSysex } from '@texed/dx7-format/params';
import { acedToSysex, createDefaultAmem } from '@texed/dx7-format/amem';
import { initVoice } from '@texed/dx7-format/cartridge';
import { NUM_PARTS, defaultPartConfig } from '@texed/dx7-format/part-config';
import type { MidiConnection } from './midi';

export class HardwareMidiPort implements SynthPort {
  private conn: MidiConnection | null = null;
  private outId = '';
  private listeners = new Set<(e: SynthEvent) => void>();
  private voice = initVoice();
  private supplement = createDefaultAmem();

  /** Bind/rebind the Web MIDI connection; the app's MIDI setup owns it. */
  setConnection(conn: MidiConnection | null): void {
    this.conn = conn;
  }

  /** Select the output device that receives everything this port sends. */
  setTarget(id: string): void {
    this.outId = id;
  }

  async start(): Promise<void> {
    // Nothing to bring up - the app owns the Web MIDI connection. Seed the UI
    // with an editable default state, since the hardware can't be queried for
    // program lists or rack state.
    this.emit({ type: 'voice', data: this.voice.slice(), supplement: this.supplement.slice() });
    this.emit({
      type: 'parts',
      configs: Array.from({ length: NUM_PARTS }, (_, i) => defaultPartConfig(i === 0)),
      selectedPart: 0,
    });
    this.emit({ type: 'programState', options: [], banks: [] });
    this.emit({ type: 'masterTune', cents: 0 });
  }

  send(cmd: SynthCommand): void {
    switch (cmd.type) {
      case MsgType.NoteOn:
        this.bytes([0x90 | this.ch(cmd.channel), cmd.note & 0x7f, cmd.velocity & 0x7f]);
        break;
      case MsgType.NoteOff:
        this.bytes([0x80 | this.ch(cmd.channel), cmd.note & 0x7f, 0x40]);
        break;
      case MsgType.Cc:
        this.bytes([0xb0 | this.ch(cmd.channel), cmd.controller & 0x7f, cmd.value & 0x7f]);
        break;
      case MsgType.PitchBend:
        this.bytes([0xe0 | this.ch(cmd.channel), cmd.value & 0x7f, (cmd.value >> 7) & 0x7f]);
        break;
      case MsgType.Aftertouch:
        this.bytes([0xd0 | this.ch(cmd.channel), cmd.value & 0x7f]);
        break;
      case MsgType.SetParam:
        this.voice[cmd.offset] = cmd.value;
        this.bytes(voiceParamChangeSysex(cmd.offset, cmd.value));
        break;
      case MsgType.SetSupplementParam:
        // No single-parameter ACED change on the wire; re-send the full dump.
        this.supplement[cmd.offset] = cmd.value;
        this.bytes(acedToSysex(this.supplement));
        break;
      case MsgType.LoadVoice:
        this.voice = new Uint8Array(cmd.data);
        if (cmd.supplement) this.supplement = new Uint8Array(cmd.supplement);
        this.bytes(acedToSysex(this.supplement));
        this.bytes(voiceToSysex(this.voice));
        if ((cmd.partIndex ?? 0) === 0) {
          this.emit({
            type: 'voice',
            data: this.voice.slice(),
            supplement: this.supplement.slice(),
          });
        }
        break;
      case MsgType.Panic:
        for (let c = 0; c < 16; c++) this.bytes([0xb0 | c, 123, 0]);
        break;
      default:
        // Library/rack/session commands have no hardware equivalent (yet).
        break;
    }
  }

  onEvent(cb: (e: SynthEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private ch(channel: number | undefined): number {
    return ((channel ?? 1) - 1) & 0x0f;
  }

  private bytes(data: Uint8Array | number[]): void {
    if (this.outId) this.conn?.send(this.outId, data);
  }

  private emit(e: SynthEvent): void {
    for (const cb of this.listeners) cb(e);
  }
}
