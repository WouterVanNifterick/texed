# Architecture

Texed is a pnpm workspace under `texed-ts/`. Three library packages hold all domain logic; the
React app, the AudioWorklet, and the CLI are hosts that consume them.

## Layers

```
@texed/dx7-format     voice bytes, SysEx, banks, performances, MiniDexed INI    (no deps)
        |
        +-- @texed/dx7-engine       SynthRack, FM DSP, envelope simulation
        |           |
        |           +-- src/worklet/texed-processor.ts    browser audio host
        |           +-- apps/cli                          headless MIDI to WAV host
        |
        +-- @texed/synth-protocol   command and event types, SynthPort interface
                    |
                    +-- src/audio    useSynth, WorkletPort, HardwareMidiPort
                            |
                            +-- src/{ui,envelope,components}, src/App.tsx    React UI
```

Rules that hold today and are worth keeping:

- `dx7-format` has no workspace dependencies. It is pure data: byte layouts, parsing, serializing.
- No package imports React or touches the DOM. The engine runs unchanged in a worklet and in Node.
- No package imports from `src/`. Dependencies point one way, toward `dx7-format`.
- Nothing is re-exported through a second module for convenience. A constant reachable by two
  import paths means nobody can tell which one is canonical, and both drift.

## The UI tree

| Path              | Holds                                                               |
| ----------------- | ------------------------------------------------------------------- |
| `src/ui/`         | The control vocabulary: Knob, Cycle, Toggle, Segmented, PartSlider, |
|                   | NoteRange, icons, and `op-colors.ts` (the per-operator palette).    |
| `src/envelope/`   | Everything that draws or edits an envelope: EnvEditor, EnvOverlay,  |
|                   | `env-draw.ts` (geometry), `env-time.ts` (shared time/level scales). |
| `src/components/` | Application panels and overlays, which compose the two above.       |
| `src/state/`      | Session persistence, patch file I/O, the library index, help text.  |

`src/ui/` knows nothing about the DX7. `src/envelope/` is the only UI code allowed to reach into
engine internals, and only for `env-sim`.

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

The voice is 156 whole numbers everywhere, including in the engine. The one place a fractional
parameter exists is inside `EnvEditor` while a node is being dragged: the DX7 tables are coarse and
uneven (42 of the 99 EG level steps produce no change at all, and the ones that do jump by up to
3 dB), so solving the drag between two steps is what keeps the node under the cursor. It is rounded
before it reaches `setParam`, and the fractional value is kept only for drawing, and only while it
still rounds to what the voice reports - so a patch load, an undo or a knob edit retires it. See
`lerpAt` in `packages/dx7-engine/src/env-tables.ts`, which env-sim uses to read those tables at a
fractional index; it is exact at whole numbers, so env-sim still agrees with the engine on every
real patch.

Session persistence snapshots the whole rack through `GetFullState` into IndexedDB, debounced.
The serializable shape is `RackState` in `packages/dx7-format/src/rack-state.ts`.

## The SynthPort seam

`SynthPort` (`packages/synth-protocol/src/port.ts`) is the boundary between the UI and whatever
is making sound. Two implementations exist:

- `WorkletPort` runs the TypeScript engine locally in an AudioWorklet. This is the default.
- `HardwareMidiPort` translates the same commands into DX7 / DX7II / TX802 SysEx, so the editor
  drives real hardware. Enable it with the `?hw` query parameter.
- `NativeBridgePort` talks to the JUCE plugin in `texed-vst/` when the page is its WebView. The
  C++ side owns the audio and everything a DAW can automate; the port keeps a `SynthHost` here as
  the librarian, so the file formats and the voice library stay in one implementation. See
  `texed-vst/README.md`.

Because the seam is a message protocol rather than a function call, adding a parameter means
touching the protocol type, the worklet's message switch, and `useSynth`. Keep new commands
coarse enough that this stays worthwhile.

## Envelope visualization

The envelope and LFO graphs are not schematic drawings. `packages/dx7-engine/src/env-sim.ts`
replays the real envelope generator to produce the curve, which is why the display matches what
you hear. This is the one place where UI code depends on engine internals on purpose.

## Hardware accuracy

The engine started as a port of music-synthesizer-for-android, which reconstructed much of the
DX7 by inference. The v1.8 firmware disassembly and the OPS/EGS die analysis have since settled a
lot of it, and `packages/dx7-engine/src/__tests__/rom-tables.test.ts` pins our tables to the ROM
bytes so a transcription slip shows up there rather than as an unexplained golden-hash diff.

Primary sources, in the order they are worth reaching for:

- ROM disassembly — <https://github.com/ajxs/yamaha_dx7_rom_disassembly> (`yamaha_dx7_rom_v1.8.asm`,
  one 17k-line file; the `TABLE_*` and `PATCH_ACTIVATE_*` labels are where the parameter
  conversions live)
- OPS/EGS die analysis — Ken Shirriff's six-part series starting at
  <https://www.righto.com/2021/11/reverse-engineering-yamaha-dx7.html>
- Firmware overview — <https://ajxs.me/blog/Yamaha_DX7_Technical_Analysis.html>
- Measured envelope shapes — <https://tlbflush.org/notes/>
- VDX7, another bit-accurate emulator that runs the real firmware —
  <https://github.com/chiaccona/VDX7>

The framing that matters: **on real hardware the envelope generators live in the EGS chip, not in
firmware.** The ROM only converts patch bytes into EGS register writes. So the disassembly is
authoritative for parameter conversion, and says nothing about chip-internal behaviour.

[vs-dexed.md](vs-dexed.md) is the item-by-item list of what we changed and why, with line
references into both trees; it is written so the fixes could be handed upstream.

Where the two calibrations genuinely disagree — the keyboard level scaling curves, the velocity
chain, and the LFO / pitch EG / portamento rates — `engine-accuracy.ts` selects between them, and
the setting is exposed as ACCURACY in the settings menu. It defaults to `hardware`; `dexed` keeps
the msfa numbers for A/B against other Dexed-derived synths. Everything else the ROM settled was
a plain bug and is fixed unconditionally. The rate tables are built at init time, so changing the
mode rebuilds them — it is a setup change, not something to automate per note.

`env-sim.ts` and the scaling graph call the same functions from the main thread, which has its own
copy of the module state; `useSynth` mirrors the worklet's mode on every settings echo so the
pictures keep matching the sound.

### Known divergences we do not model

Found and quantified against the primary sources, deliberately not implemented:

- **COM carrier compensation.** The OPS algorithm ROM holds _(carrier count − 1)_ per operator and
  attenuates carriers by log2(N) before summing, so the user hears a consistent level as they
  change algorithm. `algorithms.ts` has no such field, which leaves algorithm 32 about 15.6 dB
  hotter than algorithm 16 relative to hardware. The largest single outstanding item.
- **Hardware quantisation grids**: 7-bit pitch bend input with a three-code centre detent
  (18.75 cent steps at range 12), an 8-bit 256-step LFO sine that never crosses zero, the
  0 / −0.39 / −0.78 cent three-semitone keyboard tuning ripple, the 4096-per-octave EGS pitch
  grid, coarse-ratio table errors up to +0.51 cents, and the pitch EG's MSB-only target compare
  (which snaps up to 74.7 cents at each stage end).
- **The fixed ~375 Hz modulation grid.** We advance the LFO once per 64-sample block (689 Hz at
  44.1 kHz); hardware updates on a 2.66 ms grid and skips the pitch EG and portamento entirely
  while MIDI RX is pending.
- **The output stage**: 15-bit operator output, a time-multiplexed 12-bit DAC plus 2-bit exponent
  level shifter, two alternating sample-and-holds summing the last two samples, a fixed 16 kHz
  analogue lowpass, and a 49096 Hz native rate. We do `>>4`, hard clip, `>>9`, `/0x8000` and a DC
  blocker. `Tanh` is built in `exp2.ts` and initialised but never used.
- **Voice allocation.** Hardware is pure round-robin over 16 slots, treats releasing and
  sustain-pedal-held voices as free, and drops the 17th note rather than stealing from a held key;
  a steal is an EGS key-off/key-on microseconds apart with no damping, which is the classic DX7
  steal click. Ours scores `+4 not playing`, so we chop release tails far less often.
- **Portamento FOLLOW mode** (`portamentoMode` is parsed in `amem.ts` but never applied) and
  **DX7II fractional key scaling** (`scalingMode` / `fksEnabled` likewise).
- **Master tune** is ±74.7 cents in 0.586 cent steps on hardware and reaches only the voice
  register, so fixed-frequency operators are unaffected. We fold it into `pitchBase`, unbounded.

### Not answerable from the ROM

The firmware writes a register and stops, so the disassembly can neither confirm nor refute these
msfa models: keyboard **rate** scaling (the EGS derives it from the transposed, master-tuned,
pitch-EG-modulated frequency; we use the bare MIDI note), the EG increment mantissa/exponent
formula, the `statics[]` hold table, the `1716` attack floor, the detune register's mapping to
frequency, and the AMS 0-3 coefficients — hence `extendedAmsTable` in `amem.ts` stays a documented
guess.

## Audio thread constraints

`texed-processor.ts` `process()` runs on the real-time audio thread. Code reached from it must
not allocate: no array or object literals, no `map`/`filter`/`slice`, no closures. Buffers are
preallocated and reused, `getStatus()` fills a reused object rather than building one, and the
rack renders straight into the output channels instead of through a scratch pair.

`packages/dx7-engine/src/__tests__/render-golden.test.ts` hashes the rendered output of all 32
algorithms and 8 ROM1A voices on each of the three engines, one hash per case in
`fixtures/render-golden.json`. It exists so that changes made for allocation reasons have to prove
they are bit-identical. Accept a deliberate change with `UPDATE_GOLDEN=1` and say why in the
commit message.

The reused status message in `texed-processor.ts` is not just a convention: the processor test
asserts that every status post is the same object, so reintroducing a literal there fails CI.

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
- `src/**/__tests__/` covers the controls, the MIDI translation layer, session persistence, the
  `useSynth` mirror, and the worklet processor's message switch.
- `apps/cli/src/__tests__/` covers the SMF reader and the WAV encoder.
- `e2e/smoke.spec.ts` boots the built app in Playwright: it boots and plays a note, then loads a
  library bank, edits a parameter, saves the voice, and reloads to check the session came back.

Test files are typechecked by `tsconfig.test.json`, a separate project so the source configs can
stay narrow — the engine must not gain `node` types, or nothing stops a worklet file reaching for
`Buffer`. They were unchecked for a long time, which is how a golden test came to assert against a
property name that did not exist.

`pnpm lint` runs oxlint with `--deny-warnings`, so a warning fails CI. `pnpm test:coverage`
enforces per-area coverage floors set in `vite.config.ts`. They are floors, not targets: raise
them as coverage grows. They are per-area because one global number could only ever be set low
enough to say nothing about the engine, which sits near 90% while the React layer is far lower.
