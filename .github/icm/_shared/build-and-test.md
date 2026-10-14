---
verified_at: 2026-10-14
verified_commit: a9cb4d0f2f69bc260e7797c622e4dda7c55bd2b7
---

# Build and test — how to run what CI runs

## Commands

The scripts are `package.json:7-16`: `npm run build`, `npm run typecheck`, `npm test` (vitest run), `npm run test:watch`, `npm run test:coverage` (v8). Install with `npm ci`.

- **Node.** The dev tree needs Node 24.16+ to install: `openclaw` is a dev dependency at the version the fleet runs (`package.json:44`) and refuses older Node. Vitest 5 runs on 22.12+. CI runs Node 24 (`ci.yml`). The published package has no runtime dependencies and runs wherever its host does.
- **`npm ci` runs this package's own install hooks** (`package.json:11`, `package.json:15`). `scripts/postinstall.cjs` installs and verifies the `better-sqlite3` binding, then copies the checkout into `~/.openclaw/extensions/plugin-memoryrelay-ai` and restarts a running gateway (`scripts/postinstall.cjs:163-210`). On a machine with a live OpenClaw, set `OPENCLAW_POSTINSTALL_NO_RESTART=1` (`scripts/postinstall.cjs:200`) and remove the copy afterwards if it was not wanted.

## Build and packaging

- The package must ship compiled JavaScript: OpenClaw 2026.7.1 and later refuse a `.ts` entry point and abort the gateway's startup migration (issue #138). `main` and `openclaw.extensions` point at `./dist/index.js` (`package.json:6`); `dist/` is in `files` (`package.json:54`) and in `.gitignore`. `tests/packaging.test.ts` guards all three.
- `scripts/build.mjs` is transpile-only (`ts.transpileModule`, `scripts/build.mjs:10-17`) and mirrors the source tree (`index.ts` to `dist/index.js`, `src/x.ts` to `dist/src/x.js`). It does not type check, so the build stays green while the SDK type errors are worked through.
- `npm run typecheck` (`tsc --noEmit`, `tsconfig.json`) is not run by CI: it reports pre-existing errors against the OpenClaw SDK (83 on 2026-10-14). A change must not add to them.
- Relative imports carry an explicit `.js` extension: Node's ESM resolver rejects extensionless specifiers in `dist/` though vitest accepts them in source.
- Anything resolved from `import.meta.url` must work from the package root and from `dist/`; the version lookup that walks up to `package.json` is the pattern (`index.ts:25-49`).

## Tests

- Vitest 5 with `@vitest/coverage-v8` (`package.json`); tests live in `tests/` (mirroring `src/`), `src/*.test.ts` and `index.test.ts`.
- The OpenClaw plugin SDK is mocked; no test calls the real API. Client tests stub `fetch` (`tests/client/icm-client.test.ts`). Pipeline stages are pure functions with a unit test each (`tests/pipelines/`).
- Cache tests use in-memory SQLite and need the `better-sqlite3` binding the postinstall provides (`tests/cache/local-cache.test.ts`).
- On Windows three tests fail that pass on CI: they assert POSIX file modes (`0600`) and paths (`tests/memory/icm-corpus.test.ts:156`, `tests/memory/memory-md-sync.test.ts`). CI on ubuntu is the reference.

## CI on a pull request

| Workflow | Job | What it proves |
|---|---|---|
| `ci.yml` | `test` | `npm ci` and `npm test` on Node 24 |
| `ci.yml` | `build` | `npm run build`, then imports `dist/index.js` and checks the default export |
| `ci-cd.yml` | `validate` | manifest and required files exist, build, and the npm tarball ships `main` |
| `icm-check.yml` | `icm` | the files under `.github/icm/` are generated and lint clean |

Publishing is in [release.md](release.md).
