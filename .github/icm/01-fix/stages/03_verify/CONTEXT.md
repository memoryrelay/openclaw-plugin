# 03_verify — checks, version, pull request

One job: prove the fix the way CI proves it, give it its version and changelog entry, and open the pull request.

## Inputs
- Working (this run): `.github/icm/01-fix/stages/02_fix/output/change.md`
- Reference (every run): `.github/icm/_shared/build-and-test.md`
- Reference (every run): `.github/icm/_shared/release.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/api-alignment.md`.

## Process
1. Run what CI runs: `npm ci`, `npm test`, `npm run build` and the import of `dist/index.js` (`ci.yml`), and the tarball check (`ci-cd.yml`). Keep the output.
2. Bump the patch version in every place [release.md](../../../_shared/release.md) names, and add `## [X.Y.Z] - YYYY-MM-DD` with a `### Fixed` entry to `CHANGELOG.md`: what a user saw, what changed.
3. If the fix changed a fact a `_shared/` file points at, correct that pointer in the same pull request and run `python .github/icm/_system/generate.py`.
4. Open the pull request from a branch, subject `fix(<scope>): … (X.Y.Z)`, body with the reproduction, the cause and the evidence. Never merge it yourself.
5. Watch CI (`CI`, `CI/CD`, `ICM check`) until green on the head commit; a red job is this run's to fix.

## Outputs
- pull-request.md → output/ — the pull request URL; the version; the suites run and their results; the changelog entry; CI status on the head commit.

## Human check
A reviewer reads `pull-request.md` and the CI results and merges or sends it back; after a merge, the person decides whether to start `03-release` to publish.
