# Using Texed

Texed runs in the browser. The hosted demo is at
https://woutervannifterick.github.io/texed/.

## First steps

1. Open the demo (or run `pnpm dev` locally — see the root [README](../README.md)).
2. Click LET'S PLAY! to start the audio engine and Web MIDI. Browsers require a user gesture
   before they will make sound.
3. Play notes with the on-screen keyboard, your QWERTY keys (see below), or a Web MIDI input.
4. Browse factory and community banks in the library, or use LOAD and drag-and-drop for your
   own `.syx` files.

The whole rack — loaded banks, all eight parts, your edits — is snapshotted to IndexedDB and
restored on your next visit in the same browser profile. View preferences (envelope axis modes,
layout, reference key) are kept separately in local storage.

## Playing notes

| Input              | Behavior                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------- |
| On-screen keyboard | Click keys                                                                                |
| QWERTY             | `A`–`K` row maps to semitones starting at MIDI note 60 (C4); `W/E/T/Y/U/O/P/;` are sharps |
| Web MIDI           | Standard note on/off after audio has started                                              |
| Part select        | `F1`–`F8` select timbral parts when the part rack is in use                               |
| Operator select    | Digit keys `1`–`6` select the operator being edited                                       |

## Editing a voice

All classic DX7 voice parameters are on one screen: six operators (EG, scaling, output),
algorithm, feedback, LFO, pitch EG, transpose, and related globals.

- Knobs: drag vertically, hold Shift for fine steps, mouse wheel to step. Click to cycle
  enumerated values such as curves and LFO wave.
- Envelopes: the curve comes from the same envelope generator as the audio, so it is not a
  schematic. Drag a node sideways to change that stage's rate, or up and down for its level.
- Undo and redo: Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y), and the two arrows next to STORE. A whole
  knob drag counts as one step. History covers the edited voice, not part routing or which
  program is selected.
- LOAD imports a 32-voice cartridge; SAVE downloads the current voice as a single-voice dump.

Engine flavour (MODERN, MARK I, OPL) changes operator behaviour where the original hardware
differed; see the comparison table in the root README.

## Performances and multi-timbral setups

A performance combines up to eight DX7 voices (layers, splits, routing). Texed can load
performance banks from the built-in library or from SysEx you provide. Use the part rack and
library browser to switch voices and performances.

Details of bundled collections live in [patch-library.md](patch-library.md).

## Patches and files

- Supported imports include standard DX7 voice dumps and many multi-voice / performance SysEx
  files Texed recognizes (same loader as the CLI — see [cli.md](cli.md)).
- You can also drag and drop `.syx` or MiniDexed performance `.ini` files onto the app after starting.
- MiniDexed `.ini`: LOAD and SAVE support 8-TG performance files (`performance.ini`). Routing, volume, pan, note limits, and embedded `VoiceData` apply in Texed; FX and other MiniDexed-only keys are kept on save but not applied while editing.

## Hardware MIDI editor

To drive a real DX7, DX7II, or TX802 over MIDI instead of (or alongside) the local engine, see
[hardware-midi.md](hardware-midi.md).

## Browser notes

- Use a recent Chromium, Firefox, or Safari with Web Audio and, optionally, Web MIDI.
- If you hear nothing, confirm you clicked LET'S PLAY! and that the tab is not muted.
- Private browsing can block IndexedDB, in which case the session simply is not restored.
