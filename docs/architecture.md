# Architecture

Texed is a pnpm workspace under `texed-ts/`. Three library packages hold all domain logic; the
React app, the AudioWorklet, and the CLI are hosts that consume them.

## Layers

```
@texed/dx7-format     voice bytes, SysEx, banks, performances, MiniDexed INI    (no deps)
        |
        +-- @texed/dx7-engine       SynthRack, FM DSP, envelope simulation
        |           |
        |           +-- src/worklet/dexed-processor.ts    browser audio host
        |           +-- apps/cli                          headless MIDI to WAV host
        |
        +-- @texed/synth-protocol   command and event types, SynthPort interface
                    |
                    +-- src/audio    useSynth, WorkletPort, HardwareMidiPort
                            |
                            +-- src/components, src/App.tsx    React UI
```

Rules that hold today and are worth keeping:

- `dx7-format` has no workspace dependencies. It is pure data: byte layouts, parsing, serializing.
- No package imports React or touches the DOM. The engine runs unchanged in a worklet and in Node.
- No package imports from `src/`. Dependencies point one way, toward `dx7-format`.

## Where state lives

The authoritative patch state is the `SynthRack` inside the AudioWorklet, not in React. The main
thread keeps a mirror for rendering.

An edit follows this path:

1. A control calls `setParam`, which optimistically updates the React `voice` copy and posts a
   `SetParam` command to the worklet.
2. The worklet applies it to `SynthRack`. No reply is sent, so parameter edits do not echo.
3. Operations that change more than one value (loading a bank, selecting a part, restoring a
   session) post `voice`, `parts`, `programState`, or `settings` events back, and the mirror is
   replaced from those.

Session persistence snapshots the whole rack through `GetFullState` into IndexedDB, debounced.
The serializable shape is `RackState` in `packages/dx7-format/src/rack-state.ts`.

## The SynthPort seam

`SynthPort` (`packages/synth-protocol/src/port.ts`) is the boundary between the UI and whatever
is making sound. Two implementations exist:

- `WorkletPort` runs the TypeScript engine locally in an AudioWorklet. This is the default.
- `HardwareMidiPort` translates the same commands into DX7 / DX7II / TX802 SysEx, so the editor
  drives real hardware. Enable it with the `?hw` query parameter.

Because the seam is a message protocol rather than a function call, adding a parameter means
touching the protocol type, the worklet's message switch, and `useSynth`. Keep new commands
coarse enough that this stays worthwhile.

## Envelope visualization

The envelope and LFO graphs are not schematic drawings. `packages/dx7-engine/src/env-sim.ts`
replays the real envelope generator to produce the curve, which is why the display matches what
you hear. This is the one place where UI code depends on engine internals on purpose.

## Audio thread constraints

`dexed-processor.ts` `process()` runs on the real-time audio thread. Code reached from it must
not allocate: no array or object literals, no `map`/`filter`/`slice`, no closures. Buffers are
preallocated and reused, `getStatus()` fills a reused object rather than building one, and the
rack renders straight into the output channels instead of through a scratch pair.

`packages/dx7-engine/src/__tests__/render-golden.test.ts` hashes the rendered output of every
engine and algorithm. It exists so that changes made for allocation reasons have to prove they
are bit-identical.

Status telemetry is posted every 12 render quanta, roughly 31 Hz. `useSynth` keeps only the
newest frame and fans it out to `subscribeStatus` listeners once per animation frame, so the
meters coalesce into one render pass and stop entirely while the tab is hidden.

## Patch library

`patches/` holds the source `.syx` banks. `scripts/build-patch-library.mts` packs them into
`public/library/` with a manifest at build time. The browser fetches the manifest when the
library panel first opens, then loads individual banks on demand. Nothing from the library is in
the JS bundle.

## Tests

- `packages/dx7-engine/src/__tests__/` holds the DSP and format tests, including golden SysEx
  fixtures, a TX802 factory regression audit, and the render hash. These protect audio output.
- `src/**/__tests__/` covers control components, the MIDI translation layer, session persistence,
  and the `useSynth` mirror.
- `apps/cli/src/__tests__/` covers the SMF reader and the WAV encoder.
- `e2e/smoke.spec.ts` boots the built app in Playwright: it boots and plays a note, then loads a
  library bank, edits a parameter, saves the voice, and reloads to check the session came back.

`pnpm lint` runs oxlint with `--deny-warnings`, so a warning fails CI. `pnpm test:coverage`
enforces coverage floors set in `vite.config.ts`; raise them as coverage grows rather than
treating them as a target.
