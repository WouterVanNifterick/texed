# Texed

A DX7 FM synthesizer in the browser — a TypeScript port of the
[Dexed](https://github.com/asb2m10/dexed) / msfa engine with a full
single-screen patch editor.

```
pnpm install
pnpm dev      # dev server
pnpm test     # engine tests
pnpm build    # production build
pnpm cli song.mid --syx bank.syx   # headless render to WAV
```

## Architecture

A pnpm workspace. The DX7 domain is split into packages so the engine runs
anywhere (browser AudioWorklet today, Node CLI, later a JUCE/C++ host behind
the same protocol) and the UI can edit more than the local engine (e.g. a
hardware DX7/TX802 over MIDI SysEx):

| Package                   | What                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/dx7-format`     | DX7/DX7II/TX802 data formats: the 156-byte voice layout and parameter metadata, VMEM/VCED/AMEM/ACED SysEx pack/unpack, cartridges, performances, part configuration, the 32-algorithm routing table, rack snapshots. Pure data — no DSP, no DOM (enforced: compiled without the DOM lib).                                                                                                  |
| `packages/dx7-engine`     | The real-time DSP, bit-exact port of msfa: operators, envelopes, LFO, FM core, voice allocation (`Part` / `SynthRack`). Renders into `Float32Array`s; host-agnostic, no DOM. Depends only on `dx7-format`.                                                                                                                                                                                 |
| `packages/synth-protocol` | The control protocol (`SynthCommand` / `SynthEvent`) and the `SynthPort` interface every transport implements. Depends only on `dx7-format` types.                                                                                                                                                                                                                                         |
| `apps/cli`                | Headless Node host: parses a Standard MIDI File, drives `SynthRack`, writes a WAV.                                                                                                                                                                                                                                                                                                         |
| `src/` (web app)          | React editor + web platform glue. `src/audio/worklet-port.ts` implements `SynthPort` over an `AudioWorklet` running `src/worklet/dexed-processor.ts`; `useDexedSynth.ts` is React glue over a port (a hardware-MIDI or JUCE-bridge port can be swapped in). `src/state/` holds UI state, the patch library (fetch), and session persistence (IndexedDB) — deliberately outside the engine. |

Dependency rule, strictly one-directional: `ui → synth-protocol → dx7-format`
and `hosts (worklet, cli) → dx7-engine → dx7-format`.

**Hardware editor mode**: open the app with `?hw` and the UI drives a real
DX7/DX7II/TX802 instead of the local engine — knob edits become live VCED/ACED
SysEx, notes and controllers go out as channel messages
(`src/audio/hardware-midi-port.ts`). Pick the MIDI output in settings; `SEND`
still dumps the full voice. Without `?hw`, the `LIVE` toggle mirrors edits to
hardware while the local engine plays.

## Editing

- Every DX7 voice parameter is on screen: per operator EG rates/levels,
  key level scaling (break point, depths, curves), rate scaling, AMS,
  velocity, output level, oscillator mode/coarse/fine/detune — plus
  algorithm, feedback, osc key sync, LFO, pitch EG and transpose.
- Knobs: drag vertically (Shift = fine), or mouse wheel. Enumerated
  values (curves, LFO wave, mode) click to cycle.
- `LOAD` reads a 32-voice cartridge (`.syx`); `SAVE` downloads the
  current voice as a single-voice SysEx dump.
- Play via mouse, QWERTY (A–K row) or Web MIDI.
