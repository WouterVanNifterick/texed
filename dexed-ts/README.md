# Dexed Web

A DX7 FM synthesizer in the browser — a TypeScript port of the
[Dexed](https://github.com/asb2m10/dexed) / msfa engine with a full
single-screen patch editor.

```
pnpm install
pnpm dev      # dev server
pnpm test     # engine tests
pnpm build    # production build
```

## Architecture

Three layers, strictly one-directional (`ui → state → engine`):

| Layer | Where | What |
|---|---|---|
| **Engine** | `src/engine/` | Pure DSP, bit-exact port of msfa: operators, envelopes, LFO, the 32-algorithm FM core, voice allocation (`SynthUnit`). No DOM, no React. |
| **State** | `src/state/` | The 156-byte unpacked DX7 voice: parameter offsets & ranges (`params.ts`), display formatting, single-voice SysEx export, and the algorithm graph derivation used by the UI (`algo.ts`). Pure data. |
| **Bridge** | `src/worklet/`, `src/audio/` | The engine runs inside an `AudioWorklet` (`dexed-processor.ts`). `protocol.ts` defines the message types; `useDexedSynth.ts` mirrors the current voice into React state, sends single-byte `setParam` edits to the worklet, and fans out a ~30 Hz realtime status stream (per-op envelope level & stage, LFO level) to the meters. |
| **UI** | `src/components/` | The editor: 6 operator panels + global panel (algorithm, LFO, pitch EG), knobs/cycle buttons/toggles, envelope graphs and the on-screen keyboard. Everything fits one screen — no scrolling, no popups. |

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
