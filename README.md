# Texed

A browser-based FM synthesizer.
Browser-based emulator of Yamaha DX7, DX7II, TX802 and TX816 synthesizers.

**Live demo: https://woutervannifterick.github.io/texed/**

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

## Highlights

- Realtime editing and visualization- 
- **Accurate envelope visualization, not a schematic.** Envelope curves are
  computed by replaying the actual DSP envelope generator, so the on-screen shape
  matches what the engine really plays.
  Envelopes are directly draggable to edit rate and level.
- **Built-in patch library.** Hundreds of factory and community DX7/TX802/FS1R voice banks from the built-in library browser.
- **Load/save patches.**
- Use MIDI or QwERTY keyboard
- Emits sysex parameter changes over MIDI, so if you own a DX7 you can use this as an editor.
- **Session persistence.** Your current patch and UI state are saved locally
- There's a headless rendered, so you can invoke the synth engine from the command-line.

## Background
This started out as a port of Dexed (Pascal Gauthier and others) to TypeScript and React
Dexed itself is written around MSFA (Raph Levien / Google in 2012).

Dexed can play one DX7 voice accurately, but does not support "Performances".
A "Performance" is a patch that consists of up to 8 DX7 voices, that can be played
together, as layers and/or splits.

These performances allow for richer, and more complex and interesting sounds.

## Repository layout

| Path        | Contents                                                                                                                           |
|-------------|------------------------------------------------------------------------------------------------------------------------------------|
| `texed-ts/` | The app: React UI, DX7 engine/format packages, CLI host, tests                                                                     |
| `patches/`  | Factory and third-party DX7/DX5/TX802 voice/performance banks (`.syx`, etc.), packed into the app's built-in library at build time |

## Development

- Lint: `oxlint`, Format: `prettier`, Type checking: `tsc`
- Tests: `vitest` (unit) and `playwright` (e2e), run from `texed-ts/`
- CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs lint, test, and build on every push and pull request.
- Deploys ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) build `texed-ts` and publish it to GitHub Pages on every push to `master`.


```bash
cd texed-ts 
pnpm install  # install dependencies
pnpm dev      # start the dev server
pnpm test     # run engine/unit tests
pnpm build    # production build
pnpm cli song.mid --syx bank.syx   # headless render to WAV
```

See [texed-ts/README.md](texed-ts/README.md) for the architecture breakdown (workspace packages, editing controls, hardware mode), and [texed-ts/package.json](texed-ts/package.json) for available scripts.

## Support / Contributing

Feel free to open an issue or PR if you have any questions or suggestions!

Wouter van Nifterick