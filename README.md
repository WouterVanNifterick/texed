# Texed

A Yamaha DX7 in the browser, with the editor the DX7 never had. Six-operator FM,
accurate enough to be a port rather than an imitation, plus the multi-timbral
model of a TX802/TX816 rack: eight parts, performances, up to 256 voices.

Live demo: https://woutervannifterick.github.io/texed/

## Quick start

1. Open the [demo](https://woutervannifterick.github.io/texed/) and click LET'S PLAY!
2. Play with the on-screen keyboard, your QWERTY keys, or Web MIDI
3. Load patches from the built-in library, or drag your own `.syx` files onto the page

See [docs/using-texed.md](docs/using-texed.md) for the full tour, and
[docs/hardware-midi.md](docs/hardware-midi.md) for driving real hardware over SysEx (`?hw`).

## What it does that others don't

Dexed plays a single DX7 voice very accurately, but a TX802 patch is eight voices
layered, split and routed together, and Dexed has nowhere to put that. Texed models
the whole rack, so factory TX802 and TX816 banks load and sound like themselves.

The envelope displays are not drawings. Each curve is produced by replaying the real
envelope generator sample by sample, which is why the graph matches what you hear —
including the awkward parts, like a rate that stalls or a level that never arrives.
The nodes are draggable, so you can edit a stage by pulling it where you want it.

Beyond that: hundreds of factory and community banks built in
([docs/patch-library.md](docs/patch-library.md)), cartridge and single-voice SysEx
import/export, MiniDexed `.ini` performances, micro-tuning, undo/redo, a session that
survives a reload, and a headless CLI that renders MIDI to WAV
([docs/cli.md](docs/cli.md)).

## Compared to the hardware

|                       | DX7      | Dexed | DX7II    | TX802 | TX816 | Texed |
| --------------------- | -------- | ----- | -------- | ----- | ----- | ----- |
| Parts (multi-timbral) | 1        | 1     | 2        | 8     | 8     | 8     |
| Loads performances    | no       | no    | yes      | yes   | yes   | yes   |
| Polyphony             | 16       | 16    | 16       | 16    | 128   | 256   |
| Mark I operator       | yes      | yes   | no       | no    | yes   | yes   |
| Mark II operator      | no       | yes   | yes      | yes   | no    | yes   |
| Form                  | keyboard | VST   | keyboard | rack  | rack  | web   |

Mark I and Mark II refer to the two operator behaviours in the DX7 family. Texed ships
both, plus an OPL-flavoured third engine, selectable from the top bar.

## Background

Texed is a TypeScript port of [Dexed](https://github.com/asb2m10/dexed) (Pascal Gauthier
and others), which builds on MSFA (Raph Levien / Google, 2012). The DSP is a deliberate
line-by-line port; a golden test hashes the rendered output of all 32 algorithms on each
engine so a refactor cannot quietly change the sound.

## Layout

| Path        | Contents                                                            |
| ----------- | ------------------------------------------------------------------- |
| `texed-ts/` | The app: React UI, engine and format packages, CLI host, tests      |
| `patches/`  | Source `.syx` banks, packed into the built-in library at build time |
| `docs/`     | User and contributor guides                                         |

## Development

Needs Node.js 24+ and pnpm.

```bash
cd texed-ts
pnpm install
pnpm dev      # dev server, rebuilds the patch library first
pnpm test     # unit tests
pnpm build    # production build
pnpm cli song.mid --syx bank.syx   # headless WAV render, see docs/cli.md
```

Lint with oxlint, format with prettier, typecheck with tsc — `pnpm lint`, `pnpm format`,
`pnpm typecheck`. [CI](.github/workflows/ci.yml) runs all of it plus Playwright on every
push and PR; [deploy](.github/workflows/deploy.yml) publishes Pages from `master`.

Start with [docs/architecture.md](docs/architecture.md) — it explains why the patch state
lives in the AudioWorklet rather than in React, which is the one thing worth knowing before
changing anything. Then [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GPL v3, inherited from [Dexed](https://github.com/asb2m10/dexed). Full text in
[LICENSE](LICENSE). The bundled `.syx` data under `patches/` is third-party and factory
content — see [docs/patch-library.md](docs/patch-library.md).

## Support

[GitHub issues](https://github.com/WouterVanNifterick/texed/issues) or a pull request.

Wouter van Nifterick
