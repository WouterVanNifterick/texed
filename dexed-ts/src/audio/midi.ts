// Minimal WebMIDI input router.

export interface MidiHandlers {
  noteOn: (note: number, velocity: number, channel: number) => void;
  noteOff: (note: number, channel: number) => void;
  controlChange: (controller: number, value: number) => void;
  pitchBend: (value: number) => void;
  aftertouch: (value: number) => void;
}

export interface MidiConnection {
  access: MIDIAccess;
  inputNames: string[];
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
      h.controlChange(data[1], data[2]);
      break;
    case 0xd0:
      h.aftertouch(data[1]);
      break;
    case 0xe0:
      h.pitchBend(data[1] | (data[2] << 7));
      break;
  }
}

export async function initMidi(handlers: MidiHandlers): Promise<MidiConnection | null> {
  if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
    return null;
  }
  const access = await navigator.requestMIDIAccess({ sysex: false });
  const inputNames: string[] = [];

  const listener = (e: MIDIMessageEvent) => {
    if (e.data) handleMessage(new Uint8Array(e.data), handlers);
  };

  const attach = () => {
    inputNames.length = 0;
    access.inputs.forEach((input) => {
      inputNames.push(input.name ?? 'MIDI Input');
      input.onmidimessage = listener;
    });
  };
  attach();
  access.onstatechange = attach;

  return {
    access,
    inputNames,
    close: () => {
      access.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
      access.onstatechange = null;
    },
  };
}
