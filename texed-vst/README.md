# texed-vst

The Texed synth as a VST3 / standalone plugin. The audio engine is C++; the
editor is the same React app that runs on the web, hosted in a JUCE 8
`WebBrowserComponent` and talking to the processor over the JUCE backend
channel.

## Layout

| Path                 | What it is                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `Source/rack/`       | `TexedRack` / `TexedPart`, the C++ port of the TypeScript rack       |
| `Source/msfa/`       | Vendored msfa DSP kernel, kept close to upstream so it stays diffable |
| `Source/NativeBridge.*` | `SynthCommand` JSON to a C++ command, plus the audio-thread queue |
| `Source/WebAssets.*` | Serves the embedded React bundle to the WebView                     |
| `Source/render/`     | `texed-render`, the headless renderer used for the null test         |
| `Source/test/`       | `texed-headless`, the editor-closed checks                           |
| `packaging/`         | Staging and the Windows installer                                    |

## Building

The plugin embeds the built React bundle, so build the UI first:

```sh
cd texed-ts && pnpm build
```

Then configure and build:

```sh
cmake -S texed-vst -B texed-vst/build
cmake --build texed-vst/build --config Release
```

Artefacts land in `texed-vst/build/Texed_artefacts/`. Set
`-DTEXED_COPY_AFTER_BUILD=ON` to install into the system VST3 folder; on Windows
that needs an elevated shell.

Re-run the configure step after rebuilding the UI: the bundle is globbed at
configure time.

### Developing the UI against the plugin

One script runs `vite build --watch`, points the WebView at the live
`texed-ts/dist` folder (through `https://juce.backend/` so the JUCE native
bridge keeps working), builds the standalone, and opens it with the patch
library:

```sh
./dev.ps1
```

After each UI save, reopen the plugin window to pick up the rebuilt bundle.
C++ changes still need a rebuild (`./dev.ps1` again, or `./rebuild.ps1` for
the embedded bundle without watch). When you are done:

```sh
./stop-dev.ps1
```

`-SkipBuild` skips the cmake step if you only changed UI files and the binary
is already built. `-NoLaunch` starts the watch build and waits, but does not
open Texed.

To wire the live dist folder by hand instead:

```sh
cmake -S texed-vst -B texed-vst/build -DTEXED_LIVE_DIST=../texed-ts/dist
```

## The patch library

Megabytes of `.syx`, so it is installed beside the plugin rather than embedded,
and served to the WebView under `/library/`. Looked for in this order:

1. `TEXED_LIBRARY`, which is how you point a build at `texed-ts/dist/library`
2. `%APPDATA%\Texed\library` (`~/.config` equivalents elsewhere)
3. `%PROGRAMDATA%\Texed\library`

Without one the plugin still runs; the built-in browser is just empty.

## Packaging

```sh
cmake --build texed-vst/build --config Release --target texed-installer
```

Stages the artefacts in `build/stage` and, with Inno Setup's `iscc` on PATH,
writes an installer to `build/installer`. It carries the patch library and the
WebView2 Evergreen bootstrapper, which it runs only when the runtime is absent.
Without `iscc` the stage is still produced and the installer step is skipped.

Use `--target texed-dist` for the stage on its own.

## Checks

`texed-headless` runs the plugin the way a DAW usually does, with the window
shut: notes, MIDI, parameters, state round-trips, programs and the assets the
editor serves. It also opens the editor once and waits for the page to call
back, which is the only check that catches a bundle that loads but does not run.

## Rendering offline

`texed-render` drives the rack without a GUI or an audio device. It takes the
same `SynthCommand` JSON the WebView sends, one per line, each stamped with the
time it fires:

```sh
texed-render --commands texed-vst/test/score-smoke.jsonl --out chord.wav --seconds 3
```

It prints the peak level and exits non-zero on silence, which is what makes it
usable as a smoke test. Rendering the same score through `texed-ts`'s CLI is how
the two engines are checked against each other.

## Audio identity

The C++ and TypeScript engines have to produce the same audio, so this target is
built with `/fp:precise` (`-fno-fast-math -ffp-contract=off` elsewhere). Do not
enable fast-math: it lets the compiler reassociate the fixed-point mixing and the
two engines stop nulling.
