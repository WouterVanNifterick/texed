# Contributing

Thanks for helping improve Texed. Issues and pull requests are welcome.

## Before you open a PR

1. Discuss large changes in an issue first if you are unsure about direction.
2. Work from the `texed-ts/` directory for app and engine changes.
3. Run the same checks CI runs (from `texed-ts/`):

```bash
pnpm install
pnpm lint
pnpm typecheck   # covers test files too, via tsconfig.test.json
pnpm test
pnpm test:e2e    # optional locally; Playwright browser tests
pnpm build
```

Formatting: `pnpm format:check` (or `pnpm format` to fix).

## Where to change things

| Area                            | Location                                                |
| ------------------------------- | ------------------------------------------------------- |
| Reusable controls               | `texed-ts/src/ui/`                                      |
| Envelope drawing and editing    | `texed-ts/src/envelope/`                                |
| Application panels and overlays | `texed-ts/src/components/`                              |
| Audio worklet / browser host    | `texed-ts/src/worklet/`, `texed-ts/src/audio/`          |
| DSP engine                      | `texed-ts/packages/dx7-engine/`                         |
| SysEx, cartridges, performances | `texed-ts/packages/dx7-format/`                         |
| Headless render CLI             | `texed-ts/apps/cli/`                                    |
| Bundled patch library           | `patches/` + `texed-ts/scripts/build-patch-library.mts` |

Architecture overview: [docs/architecture.md](docs/architecture.md).

User-facing behavior: [docs/using-texed.md](docs/using-texed.md).

## If you touch the DSP

`render-golden.test.ts` hashes the rendered output of all 32 algorithms and 8 factory voices
on each of the three engines. If it fails, your change altered the sound. That is fine when
it was the point — regenerate with `UPDATE_GOLDEN=1 pnpm vitest run render-golden` and say in
the commit message which cases moved and why. It is not fine if you were only reorganizing
code, in which case the refactor is wrong.

## Commits and CI

- CI: [.github/workflows/ci.yml](.github/workflows/ci.yml) on every push and PR.
- GitHub Pages deploy: [.github/workflows/deploy.yml](.github/workflows/deploy.yml) on pushes to
  `master`.

Keep PRs focused; include a short description of what you tested.

## Questions

Open a [GitHub issue](https://github.com/WouterVanNifterick/texed/issues) or contact the
maintainer listed in the root README.
