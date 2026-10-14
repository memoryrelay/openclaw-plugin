# 04_docs — README, changelog, version, pull request

One job: make the change visible to users and reviewers, and propose it.

## Inputs
- Working (this run): `.github/icm/02-feature/stages/03_test/output/tests.md`
- Reference (every run): `.github/icm/_shared/release.md`
- Reference (every run): `.github/icm/_shared/documents.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/gotchas.md`.

## Process
1. Update `README.md` where the change shows: the tool tables and the total, configuration reference, hooks, migration notes for a breaking change.
2. Bump the version (minor for a feature, `feat!` for a breaking one) in every place [release.md](../../../_shared/release.md) names; add the `CHANGELOG.md` section.
3. Correct every `.github/icm/_shared/` pointer the change moved (a tool count, a file, an open item in `api-alignment.md`), bump that file's `verified_at` and `verified_commit`, and run `python .github/icm/_system/generate.py`.
4. Open the pull request, subject `feat(<scope>): … (X.Y.Z)`, body with the spec, the tests and any host or API prerequisite. Watch CI to green. Never merge it yourself.

## Outputs
- pull-request.md → output/ — the pull request URL; version; README and changelog changes; `_shared/` files corrected; CI status on the head commit.

## Human check
A reviewer reads `pull-request.md`, the README diff and CI, then merges or sends it back; after a merge, the person decides whether to start `03-release`.
