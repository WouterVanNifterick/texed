# Built-in patch library

Factory and community DX7 / DX5 / TX802 voice and performance data live under
[`patches/`](../patches/). At build time, `texed-ts/scripts/build-patch-library.mts` scans those
folders and emits `texed-ts/public/library/` (manifest plus bank blobs). Both `pnpm dev` and
`pnpm build` run `pnpm build:library` first.

## Collections included in the manifest

| Folder under `patches/` | Collection name (in app) |
| ----------------------- | ------------------------ |
| `DX7 Voices from FS1R`  | DX7 Voices from FS1R     |
| `TX802_Factory`         | TX802 Factory            |
| `TX802_Collections`     | TX802 Collections        |
| `DX7IIFD_Factory`       | DX7IIFD Factory          |
| `DX7s_Factory`          | DX7s Factory             |
| `DX5`                   | DX5                      |
| `DX7II_Collections`     | DX7II Collections        |
| `DX7II_Yamaha_Freeware` | DX7II Yamaha Freeware    |

`.syx` and `.mx` files are read; a folder of `.Dx7Voice` raw exports becomes one packed bank.

## Sets: how files are grouped

The manifest (schema 2) does not list files, it lists **sets** — the unit the browser loads. Each set
names the half-bank slots it fills, so the app can say up front which voice banks a performance bank
uses. Grouping runs per directory in `groupDirectory`
([`patch-library-core.mts`](../texed-ts/scripts/patch-library-core.mts)):

1. A file carrying performances **and** the banks they reference is a set on its own.
2. A performance bank with no banks of its own adopts the voice files beside it: an explicit
   `perfBankMap` entry in `build-patch-library.mts` wins, then a name hint (`…-Perfs` ↔ `…-Voices`),
   then — for a directory small enough to be unambiguous — everything in it.
3. A set still short of a bank borrows one from another file in the same directory that states the
   same half-bank (a factory cartridge referencing the internal memory saved next to it).
4. Whatever is left becomes a voice-only set per file.

References nothing can fill are recorded as `unresolvedSlots` and warned about at build time rather
than hidden; files the loader cannot read are listed as `unsupported`.

Which half-bank a dump belongs to is decided by the loader, not the filename — see
`memorySideOf` in [`sysex-loader.ts`](../texed-ts/packages/dx7-format/src/sysex-loader.ts).

## Adding or updating banks

1. Place files under the appropriate `patches/` subdirectory (or add a new collection in
   `build-patch-library.mts` if you introduce a new tree).
2. Run `pnpm build:library` from `texed-ts/` (or `pnpm dev` / `pnpm build`).
3. Read the build warnings: an unexpected `unresolvedSlots` usually means the grouping heuristic
   needs a `perfBankMap` entry.
4. Verify the library browser in the app and, if needed, extend tests under
   `texed-ts/scripts/` / format tests.

## Copyright and redistribution

Patch files are third-party or factory content collected for compatibility testing and musical use with Texed.
They remain subject to their original terms; this repository bundles them for convenience in the open-source app.

Do not assume unlimited redistribution outside this project.

Application source code licensing is described in the root [README](../README.md#license).
