# Headless CLI (MIDI → WAV)

The `@texed/cli` app renders a **Standard MIDI File** through the same **SynthRack** engine used
in the browser, without Web Audio or a UI.

## Prerequisites

From the repository root:

```bash
cd texed-ts
pnpm install
```

Requires **Node.js ≥ 24** (see `texed-ts/package.json`).

## Basic usage

```bash
pnpm cli <file.mid> [--syx bank.syx] [--out out.wav] [--rate 48000] [--program n]
```

| Option | Meaning |
| ------ | ------- |
| `<file.mid>` | Input Standard MIDI File (required) |
| `--syx` | Optional SysEx bank or single-voice dump to load before playback |
| `--out` | Output WAV path (default: same basename as the MIDI file, `.wav`) |
| `--rate` | Sample rate in Hz (default: `48000`) |
| `--program` | If set (≥ 0), select this program index on all active parts before MIDI program changes |

Examples:

```bash
pnpm cli song.mid
pnpm cli song.mid --syx path/to/bank.syx --out render.wav
pnpm cli song.mid --rate 44100 --program 0
```

## How playback maps to the engine

- MIDI **channels** map to up to **eight parts** (first eight distinct channels), similar to a
  multi-timbral rack.
- **Program change** events select voices from the loaded library when a bank was provided with
  `--syx`.
- Rendering includes note releases and a short tail; the CLI prints duration, channel count, and
  peak level (and warns on clipping).

## Implementation

Source: `texed-ts/apps/cli/src/main.ts` (argument parsing and render loop).

For workspace layout and packages, see [texed-ts/README.md](../texed-ts/README.md).
