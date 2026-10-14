# 01_review — review the bump

One job: a merge or close recommendation a person can act on.

## Inputs
- Working (this run): the pull request — `gh pr view <n> --comments` and its diff.
- Reference (every run): `.github/icm/_shared/build-and-test.md`
- Reference (every run): `.github/icm/_shared/gotchas.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/api-alignment.md`.

## Process
1. Name what moves: package, from and to, direct or transitive, dev or shipped. `bundledDependencies` and `optionalDependencies` (`better-sqlite3`, `sqlite-vec`) reach users; the dev tree does not.
2. For an `openclaw` bump, read the host's release notes for the traps in [gotchas.md](../../../_shared/gotchas.md) (register, `contracts.tools`, hook names, the memory slot, SDK subpaths) and the Node engine it needs.
3. Check CI on the pull request; if it is stale or superseded by a later bump, say so (Dependabot closed #153 and #154 when #156 moved the tree).
4. Run `npm ci` and `npm test` locally when CI is not conclusive.

## Outputs
- review.md → output/ — what moves and where it reaches; the advisory if any; CI result; the recommendation (merge, close or supersede) and why.

## Human check
A person decides to merge, close or supersede the pull request.
