# Texed

Browser-based FM synthesizer and patch editor: emulates Yamaha **DX7**, **DX7II**, **TX802**,
and **TX816**-style multi-timbral setups (eight parts, performances, up to 128-voice polyphony).

**Live demo: https://woutervannifterick.github.io/texed/**

## Quick start

1. Open the [demo](https://woutervannifterick.github.io/texed/) and click **LET'S PLAY!**
2. Play with the on-screen keyboard, **QWERTY** keys, or **Web MIDI**
3. Open the **library** or **LOAD** / drag-and-drop your own `.syx` patches

More detail: [docs/using-texed.md](docs/using-texed.md). Hardware MIDI editor:
[docs/hardware-midi.md](docs/hardware-midi.md) (`?hw` mode).

## Comparison

| feature                         |   DX7    | Dexed |  DX7II   | TX802 | TX816 | Texed |
|---------------------------------|:--------:|:-----:|:--------:|:-----:|:-----:|:-----:|
| 6 Op FM                         |    ✅     |   ✅   |    ✅     |   ✅   |   ✅   |   ✅   |
| Timbrality                      |    1     |   1   |    2     |   8   |   8   |   8   |
| Load Performances / Banks       |    ❌     |   ❌   |    ✅     |   ✅   |   ✅   |   ✅   |
| Additional routing + modulation |    ❌     |   ✅   |    ✅     |   ✅   |   ❌   |   ✅   |
| Polyphony                       |    16    |  16   |    16    |  16   |  128  |  128  |
| MIDI-in Ports                   |    1     |   1   |    1     |   1   |   8   |  all  |
| MKI operator                    |    ✅     |   ✅   |    ❌     |   ❌   |   ✅   |   ✅   |
| MKII operator                   |    ❌     |   ✅   |    ✅     |   ✅   |   ❌   |   ✅   |
| Hardware/Software               | Keyboard |  VST  | Keyboard | Rack  | Rack  |  Web  |

**Table notes:** *MKI* / *MKII operator* = operator/engine behaviors matching DX7 Mark I vs
Mark II family; *Additional routing + modulation* = performance-level routing beyond a single
DX7 voice (splits/layers/mod matrix on supported gear).

## Highlights

- **Realtime editing and visualization** on one screen
- **Accurate envelope visualization, not a schematic.** Envelope curves are computed by replaying
  the actual DSP envelope generator; drag segments to edit rate and level.
- **Built-in patch library** — hundreds of factory and community banks (see
  [docs/patch-library.md](docs/patch-library.md))
- **Load/save patches** — cartridges and single-voice SysEx
- **Web MIDI** and **QWERTY** play; optional **hardware editor** over SysEx
- **Session persistence** — patch and UI state in local storage
- **Headless CLI** — render MIDI to WAV ([docs/cli.md](docs/cli.md))

## Background

Texed is a TypeScript/React port of [Dexed](https://github.com/asb2m10/dexed) (Pascal Gauthier
and others). Dexed builds on **MSFA** (Raph Levien / Google, 2012).

Dexed plays one DX7 voice accurately but does not support **performances** — patches that combine
up to eight DX7 voices as layers, splits, and routed parts. Texed adds that multi-timbral model
and a web-native editor.

## Repository layout

| Path        | Contents                                                                                                                           |
|-------------|------------------------------------------------------------------------------------------------------------------------------------|
| `texed-ts/` | App: React UI, DX7 engine/format packages, CLI host, tests                                                                         |
| `patches/`  | Factory and third-party voice/performance banks (`.syx`, etc.), packed into the built-in library at build time                      |
| `docs/`     | User and contributor guides                                                                                                        |

## Development

Requires **Node.js ≥ 24** and **pnpm** (see `texed-ts/package.json`).

- Lint: `oxlint`, format: `prettier`, typecheck: `tsc`
- Tests: `vitest` (unit) and `playwright` (e2e), from `texed-ts/`
- CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs lint, test, and build on every push and PR
- Deploy ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) publishes GitHub Pages on push to `master`

```bash
cd texed-ts
pnpm install
pnpm dev      # dev server (rebuilds patch library)
pnpm test     # unit tests
pnpm build    # production build
pnpm cli song.mid --syx bank.syx   # headless WAV render — see docs/cli.md
```

Architecture and editing controls: [texed-ts/README.md](texed-ts/README.md). Contributing:
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Texed inherits the [Dexed](https://github.com/asb2m10/dexed) lineage and is distributed under
**GNU GPL v3**. Full license text: [dexed-juce/LICENSE](dexed-juce/LICENSE).

Bundled `.syx` data under `patches/` is third-party/factory content — see
[docs/patch-library.md](docs/patch-library.md).

## Support

Questions, bugs, and ideas: [GitHub issues](https://github.com/WouterVanNifterick/texed/issues)
or a pull request ([CONTRIBUTING.md](CONTRIBUTING.md)).

Wouter van Nifterick
