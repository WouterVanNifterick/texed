# Texed

Browser DX7 FM synth - TypeScript port of
[Dexed](https://github.com/asb2m10/dexed) / msfa with a single-screen patch
editor.

```
pnpm install
pnpm dev      # dev server
pnpm test     # engine tests
pnpm build    # production build
pnpm cli song.mid --syx bank.syx   # headless render to WAV
```

## Architecture

pnpm workspace:

| Package                   | Role                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/dx7-format`     | Voice layout, parameter metadata, SysEx pack/unpack, cartridges, performances, algorithm routing. No DSP. |
| `packages/dx7-engine`     | Real-time DSP (msfa port): operators, envelopes, LFO, FM core, voice allocation (`Part` / `SynthRack`).   |
| `packages/synth-protocol` | `SynthCommand` / `SynthEvent` and the `SynthPort` interface.                                              |
| `apps/cli`                | Headless Node host: SMF in, WAV out.                                                                      |
| `src/`                    | React UI. Worklet in `src/worklet/`, port adapters in `src/audio/`, UI state in `src/state/`.             |

Dependencies: `ui → synth-protocol → dx7-format` and
`hosts (worklet, cli) → dx7-engine → dx7-format`.

**Hardware mode** - open with `?hw` to drive a DX7/DX7II/TX802 over MIDI.
Knob edits send VCED/ACED SysEx; notes and controllers go out as channel
messages (`src/audio/hardware-midi-port.ts`). Pick the MIDI output in settings;
`SEND` dumps the full voice. Without `?hw`, the `LIVE` toggle mirrors edits
to hardware while the local engine plays.

## Editing

- All voice parameters on one screen: per-op EG rates/levels, key level
  scaling, rate scaling, AMS, velocity, output level, osc mode/coarse/fine/detune,
  plus algorithm, feedback, osc key sync, LFO, pitch EG, transpose.
- Knobs: drag vertically (Shift = fine), or mouse wheel. Click to cycle
  enumerated values (curves, LFO wave, mode).
- `LOAD` reads a 32-voice cartridge (`.syx`); `SAVE` downloads the current
  voice as a single-voice SysEx dump.
- Play via mouse, QWERTY (A–K row), or Web MIDI.
