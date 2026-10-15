---
verified_at: 2026-10-15
verified_commit: 889029f7ac3e335f3a462cf9671ed9efeb4ecd79
---

# Release — how a version reaches npm

The package is `@memoryrelay/plugin-memoryrelay-ai` on npm; its version is `package.json:3`. Nothing deploys on merge: a merge to `main` runs CI only, and a person publishes.

## Where the version lives

`RELEASING.md` lists the places to bump: `package.json` and `package-lock.json`, `openclaw.plugin.json:5` (and the `vX.Y.Z` in its description, `openclaw.plugin.json:4`), the `index.ts` JSDoc header (`index.ts:3`) and the client's `USER_AGENT` (`src/client/memoryrelay-client.ts:22`), which every request sends. `tests/version-consistency.test.ts` fails when any of them differs from `package.json`. The startup log has no literal: it prints `PLUGIN_VERSION`, read from `package.json` (`index.ts:49`, `index.ts:613`). A release bumps every literal.

## How a version is published (what has happened since 0.19)

1. The pull request that ships the change carries the version: bumped in the places above, a `CHANGELOG.md` section `## [X.Y.Z] - YYYY-MM-DD`, the version in the title (for example "(0.30.0)"). Breaking changes are `feat!` and a minor bump while below 1.0, with a "Migration Notes" entry in `README.md`.
2. A person merges it; `ci.yml` and `ci-cd.yml` run on `main`.
3. A person runs **Manual Publish to NPM** (`publish.yml`, `workflow_dispatch` with the version): it runs the tests, builds, checks `dist/index.js` exists and that the input equals `package.json`, then `npm publish --provenance` with the `NPM_TOKEN` secret. Every version from 0.25.0 to 0.30.0 went out this way.
4. Confirm with `npm view @memoryrelay/plugin-memoryrelay-ai version`.

The tag path in `ci-cd.yml` (push `vX.Y.Z`, publish, create a GitHub release) is what `RELEASING.md` describes, but the last tag and GitHub release are `v0.18.5`; its release notes take the package name from `package.json` (`.github/workflows/ci-cd.yml:91-95`). Which path is canonical is a person's decision; until then the manual dispatch is what works.

## Installing an update (for the release notes)

`openclaw plugins install` does not overwrite an existing extension; the workaround is in `RELEASING.md:16-20` and the README's "Updating" section. Config moves (for example "run `openclaw config set plugins.slots.memory memory-core`") go in the changelog entry, as 0.26.0 did (`CHANGELOG.md:52`).
