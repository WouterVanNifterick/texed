// Minimal WebMIDI input router.

export interface MidiHandlers {
  noteOn: (note: number, velocity: number, channel: number) => void;
  noteOff: (note: number, channel: number) => void;
  controlChange: (controller: number, value: number, channel: number) => void;
  pitchBend: (value: number, channel: number) => void;
  aftertouch: (value: number, channel: number) => void;
  /** Called with the current input names on connect and whenever devices are (un)plugged. */
  inputsChanged?: (names: string[]) => void;
  /** Called with the current output devices on connect and whenever devices are (un)plugged. */
  outputsChanged?: (devices: { id: string; name: string }[]) => void;
}

export interface MidiConnection {
  close: () => void;
  /** Send raw MIDI bytes to a specific output device. */
  send: (deviceId: string, data: Uint8Array | number[]) => void;
  /** Route all incoming MIDI to this output (raw pass-through), or null to stop. */
  setForwardOutput: (deviceId: string | null) => void;
}

/** System real-time bytes (clock, active sensing, reset, …) — not useful to pass through. */
export function shouldForwardMidi(data: Uint8Array | ArrayLike<number>): boolean {
  return data.length > 0 && data[0] < 0xf8;
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
  // SysEx access lets us send voice dumps and parameter changes out. If the user
  // denies it, fall back to a plain connection so input + note forwarding still work.
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess({ sysex: true });
  } catch {
    access = await navigator.requestMIDIAccess({ sysex: false });
  }

  let forwardId: string | null = null;

  const listener = (e: MIDIMessageEvent) => {
    if (!e.data) return;
    if (forwardId && shouldForwardMidi(e.data)) access.outputs.get(forwardId)?.send(e.data);
    handleMessage(new Uint8Array(e.data), handlers);
  };

  const attach = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      names.push(input.name ?? 'MIDI Input');
      input.onmidimessage = listener;
    });
    handlers.inputsChanged?.(names);
    const outputs: { id: string; name: string }[] = [];
    access.outputs.forEach((output) => {
      outputs.push({ id: output.id, name: output.name ?? 'MIDI Output' });
    });
    handlers.outputsChanged?.(outputs);
  };
  attach();
  access.onstatechange = attach;

  return {
    send: (deviceId, data) => {
      access.outputs.get(deviceId)?.send(data instanceof Uint8Array ? data : Uint8Array.from(data));
    },
    setForwardOutput: (deviceId) => {
      forwardId = deviceId;
    },
    close: () => {
      access.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
      access.onstatechange = null;
    },
  };
}
