# Built-in patch library

Factory and community **DX7 / DX5 / TX802** voice and performance data live under
[`patches/`](../patches/). At build time, `texed-ts/scripts/build-patch-library.mts` scans those
folders and emits `texed-ts/public/library/` (manifest plus bank blobs). Both `pnpm dev` and
`pnpm build` run **`pnpm build:library`** first.

## Collections included in the manifest

| Folder under `patches/` | Collection name (in app) |
| ----------------------- | ------------------------ |
| `DX7 Voices from FS1R` | DX7 Voices from FS1R |
| `TX802_Factory` | TX802 Factory |
| `TX802_Collections` | TX802 Collections |
| `DX7IIFD_Factory` | DX7IIFD Factory |
| `DX7s_Factory` | DX7s Factory |
| `DX5` | DX5 |
| `DX7II_Collections` | DX7II Collections |
| `DX7II_Yamaha_Freeware` | DX7II Yamaha Freeware |

Performance SysEx that references external voice banks is wired in the build script (for example
TX802 factory performance sets and their companion voice files).

## Adding or updating banks

1. Place files under the appropriate `patches/` subdirectory (or add a new collection in
   `build-patch-library.mts` if you introduce a new tree).
2. Run `pnpm build:library` from `texed-ts/` (or `pnpm dev` / `pnpm build`).
3. Verify the library browser in the app and, if needed, extend tests under
   `texed-ts/scripts/` / format tests.

## Copyright and redistribution

Patch files are **third-party or factory content** collected for compatibility testing and
musical use with Texed. They remain subject to their original terms; this repository bundles
them for convenience in the open-source app. Do not assume unlimited redistribution outside
this project—check Yamaha and original pack authors’ terms before republishing banks elsewhere.

Application **source code** licensing is described in the root [README](../README.md#license).
