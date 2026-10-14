# 02_prepare — make every version place agree

One job: every version literal and the changelog name the planned version on `main`.

## Inputs
- Working (this run): `.github/icm/03-release/stages/01_plan/output/plan.md`
- Reference (every run): `.github/icm/_shared/release.md`
- Reference (every run): `.github/icm/_shared/build-and-test.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/architecture.md`.

## Process
1. If every place on `main` already carries the version and the changelog section is complete, record that and go to the output.
2. Otherwise open a release pull request (`chore: release X.Y.Z`): bump each lagging place, complete the `CHANGELOG.md` section, and add README migration notes for a breaking change.
3. Run `npm ci`, `npm test`, `npm run build`, and `npm pack --dry-run` to see that `dist/index.js` ships. Watch CI to green; never merge it yourself.

## Outputs
- prepared.md → output/ — each version place and its value on `main` (or the release pull request URL); the test, build and pack results; CI status.

## Human check
A person confirms every version place agrees on `main`, merging the release pull request if there is one.
