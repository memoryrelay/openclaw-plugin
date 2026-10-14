# 03_publish — publish and confirm on npm

One job: the planned version is on npm, built from `main`, and confirmed.

## Inputs
- Working (this run): `.github/icm/03-release/stages/02_prepare/output/prepared.md`
- Reference (every run): `.github/icm/_shared/release.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/conventions.md`.

## Process
1. A person runs **Manual Publish to NPM** (`publish.yml`) on `main` with the version (`gh workflow run publish.yml -f version=X.Y.Z`, or the Actions page). The agent does not dispatch it.
2. Watch the run: tests, build, the `dist/index.js` check and the version check must pass before `npm publish`.
3. Confirm `npm view @memoryrelay/plugin-memoryrelay-ai version` answers the new version and that the published tarball holds `dist/index.js`.
4. If a publish failed, read the log before re-running: npm refuses the same version twice.

## Outputs
- published.md → output/ — the run URL and result; the npm version and tarball check, with timestamps; anything a user must do to upgrade (reinstall workaround, config moves).

## Human check
A person sees the new version on npm and reads the upgrade note before announcing it.
