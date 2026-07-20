# Using Texed

Texed runs in the browser. The hosted demo is at
https://woutervannifterick.github.io/texed/.

## First steps

1. Open the demo (or run `pnpm dev` locally — see the root [README](../README.md)).
2. Click **LET'S PLAY!** to start the audio engine and Web MIDI (browsers require a user
   gesture before sound).
3. Play notes with the on-screen keyboard, **QWERTY** keys (see below), or a **Web MIDI**
   input after the app has started.
4. Browse **factory and community banks** from the library UI, or use **LOAD** / drag-and-drop
   for your own `.syx` files.

Your current patch and most UI settings are stored in **local storage** and restored on the next
visit (same browser profile).

## Playing notes

| Input | Behavior |
| ----- | -------- |
| On-screen keyboard | Click keys |
| QWERTY | `A`–`K` row maps to semitones starting at MIDI note 60 (C4); `W/E/T/Y/U/O/P/;` are sharps |
| Web MIDI | Standard note on/off after audio has started |
| Part select | Digit keys `1`–`8` select timbral parts when the part rack is in use |

## Editing a voice

All classic DX7 voice parameters are on one screen: six operators (EG, scaling, output),
algorithm, feedback, LFO, pitch EG, transpose, and related globals.

- **Knobs:** drag vertically; hold **Shift** for fine steps; mouse wheel to step; click to cycle
  enumerated values (curves, LFO wave, etc.).
- **Envelopes:** the curve is computed by the same envelope generator as the audio engine (not a
  schematic). Drag segments to edit rates and levels.
- **LOAD:** import a 32-voice cartridge (`.syx`).
- **SAVE:** download the current voice as a single-voice SysEx dump.

Engine flavor (**MODERN**, **MARK I**, **OPL**) changes operator behavior where the original
hardware differed; see the comparison table in the root README.

## Performances and multi-timbral setups

A **performance** combines up to eight DX7 voices (layers, splits, routing). Texed can load
performance banks from the built-in library or from SysEx you provide. Use the part rack and
library browser to switch voices and performances.

Details of bundled collections live in [patch-library.md](patch-library.md).

## Patches and files

- Supported imports include standard DX7 voice dumps and many multi-voice / performance SysEx
  files Texed recognizes (same loader as the CLI — see [cli.md](cli.md)).
- You can also **drag and drop** `.syx` onto the app after starting.

## Hardware MIDI editor

To drive a real DX7, DX7II, or TX802 over MIDI instead of (or alongside) the local engine, see
[hardware-midi.md](hardware-midi.md).

## Browser notes

- Use a recent Chromium, Firefox, or Safari with Web Audio and (optionally) Web MIDI.
- If you hear nothing, confirm you clicked **LET'S PLAY!** and that the tab is not muted.
- Private browsing may limit local storage session restore.
