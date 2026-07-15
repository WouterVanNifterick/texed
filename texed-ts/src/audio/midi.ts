// Minimal WebMIDI input router.

export interface MidiHandlers {
  noteOn: (note: number, velocity: number, channel: number) => void;
  noteOff: (note: number, channel: number) => void;
  controlChange: (controller: number, value: number, channel: number) => void;
  pitchBend: (value: number, channel: number) => void;
  aftertouch: (value: number, channel: number) => void;
  /** Called with the current input names on connect and whenever devices are (un)plugged. */
  inputsChanged?: (names: string[]) => void;
}

export interface MidiConnection {
  close: () => void;
}

function handleMessage(data: Uint8Array, h: MidiHandlers): void {
  const status = data[0];
  const cmd = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  switch (cmd) {
    case 0x90:
      if (data[2] > 0) h.noteOn(data[1], data[2], channel);
      else h.noteOff(data[1], channel);
      break;
    case 0x80:
      h.noteOff(data[1], channel);
      break;
    case 0xb0:
      h.controlChange(data[1], data[2], channel);
      break;
    case 0xd0:
      h.aftertouch(data[1], channel);
      break;
    case 0xe0:
      h.pitchBend(data[1] | (data[2] << 7), channel);
      break;
  }
}

export async function initMidi(handlers: MidiHandlers): Promise<MidiConnection | null> {
  if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
    return null;
  }
  const access = await navigator.requestMIDIAccess({ sysex: false });

  const listener = (e: MIDIMessageEvent) => {
    if (e.data) handleMessage(new Uint8Array(e.data), handlers);
  };

  const attach = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      names.push(input.name ?? 'MIDI Input');
      input.onmidimessage = listener;
    });
    handlers.inputsChanged?.(names);
  };
  attach();
  access.onstatechange = attach;

  return {
    close: () => {
      access.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
      access.onstatechange = null;
    },
  };
}
