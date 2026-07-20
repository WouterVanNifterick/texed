# Hardware MIDI editor

Texed can act as a **patch editor and controller** for Yamaha DX7 (MKI), DX7II family, and
TX802 hardware over MIDI.

## Two ways to work with hardware

### Local engine + LIVE mirroring (default URL)

1. Start the app normally (no special query string).
2. Connect your synth via USB-MIDI or an interface.
3. Open **MIDI settings** and choose the **MIDI output** port for your synth.
4. Turn **LIVE** on so parameter edits send **VCED/ACED SysEx** to the hardware while the
   browser engine still plays locally.

Use this when you want to hear the patch in Texed and keep the hardware in sync.

### Hardware editor mode (`?hw`)

Open Texed with **`?hw`** on the URL (for example
`https://woutervannifterick.github.io/texed/?hw`).

In this mode the UI **does not run the local DSP engine** for editing: knob changes go out as
SysEx to the device you select. Notes and controllers are sent as ordinary MIDI channel
messages.

1. Add `?hw` to the URL and start the app.
2. Pick the **MIDI output** in settings.
3. Edit parameters; each change sends the appropriate SysEx to the synth.
4. Use **SEND** to dump the full current voice to the hardware.

Implementation reference: `texed-ts/src/audio/hardware-midi-port.ts`.

## What gets sent

- **Parameter edits:** voice SysEx (VCED) and related dumps (ACED) as you turn controls.
- **SEND:** full voice dump to the selected output.
- **Notes / wheels / pedals:** standard MIDI channel messages on the configured parts/channels.

## Tips

- Match the **engine mode** (MARK I vs MARK II operator layout) to your synth when comparing
  behavior.
- If SysEx is filtered, check MIDI thru/filter settings on the interface and synth.
- For browser-only editing without hardware, ignore this document and use the normal demo URL.

## Related reading

- [Using Texed](using-texed.md). Playing and patching in the browser.
- [texed-ts/README.md](../texed-ts/README.md). Architecture and MIDI adapter layout.
