# 01_plan — choose the version

One job: the version number and its contents, agreed before anything is bumped.

## Inputs
- Working (this run): the request — the merged pull requests since the last published version (`npm view @memoryrelay/plugin-memoryrelay-ai version`, `gh pr list --state merged`).
- Reference (every run): `.github/icm/_shared/release.md`
- Reference (every run): `.github/icm/_shared/conventions.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/api-alignment.md`.

## Process
1. Find the last published version on npm and every merged change since; read their changelog entries.
2. Choose the number: patch for fixes, minor for features, minor with `feat!` and migration notes for a breaking change while below 1.0.
3. Check the version places listed in [release.md](../../../_shared/release.md) on `main`: say which already carry the number and which lag.

## Outputs
- plan.md → output/ — the version; the changes in it with their pull requests; breaking or not and the migration steps; which version places lag.

## Human check
A person approves the version number and the list of changes.
