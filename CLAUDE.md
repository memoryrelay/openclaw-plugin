# OpenClaw MemoryRelay plugin

The OpenClaw plugin for MemoryRelay, published on npm as `@memoryrelay/plugin-memoryrelay-ai`: pinned ICM context before each turn, memory as evidence (recall and capture pipelines, a local SQLite cache), entities and agents, and MemoryRelay plus ICM files as corpora of OpenClaw's own memory. It follows the API in memoryrelay/api; what leaves this repository is a reviewed pull request, and a version a person publishes to npm.

## Where things live

| Path | What it holds |
|---|---|
| `index.ts`, `openclaw.plugin.json`, `src/` | the entry (wiring), the manifest, the client, tools, hooks, pipelines, corpora and cache — mapped in [architecture.md](.github/icm/_shared/architecture.md) |
| `tests/`, `index.test.ts` | vitest, SDK mocked and `fetch` stubbed — [build-and-test.md](.github/icm/_shared/build-and-test.md) |
| `skills/` | the three OpenClaw skills shipped to the end user's agent |
| `scripts/` | the transpile-only build and the install hooks |
| `.github/workflows/` | CI, CI/CD, the manual npm publish, the dependency graph, the ICM check |
| `README.md`, `CHANGELOG.md`, `RELEASING.md` | the user guide, every version, the release checklist — [documents.md](.github/icm/_shared/documents.md) |
| [`.github/icm/_shared/`](.github/icm/_shared/CONTEXT.md) | what every job below draws on, one file per question |
| [`.github/icm/01-fix/`](.github/icm/01-fix/CLAUDE.md) | fix a defect |
| [`.github/icm/02-feature/`](.github/icm/02-feature/CLAUDE.md) | add a capability: a tool, an option, a hook behaviour, an API catch-up |
| [`.github/icm/03-release/`](.github/icm/03-release/CLAUDE.md) | publish a version to npm |
| [`.github/icm/04-deps/`](.github/icm/04-deps/CLAUDE.md) | review a dependency bump |
| [`.github/icm/05-docs/`](.github/icm/05-docs/CLAUDE.md) | correct a document that disagrees with the code |

## Route by what just happened

| Route | If | Go to | Then stop at |
|---|---|---|---|
| triage | an issue or report arrives and its kind is unclear | read it whole (`gh issue view <n> --comments`), then take the row below that fits | the row chosen, said to the person |
| fix | a defect is reported (issue, failing test, a gateway log line, a tool that answers wrong) | [01_reproduce](.github/icm/01-fix/stages/01_reproduce/CONTEXT.md) | a person has seen the reproduction fail |
| ci-red | `CI` or `CI/CD` is red on `main` | [01_reproduce](.github/icm/01-fix/stages/01_reproduce/CONTEXT.md), with the run log as the report | a person has seen the reproduction fail |
| host-break | a new OpenClaw release stops the plugin loading, registering tools or pinning context | [01_reproduce](.github/icm/01-fix/stages/01_reproduce/CONTEXT.md), host traps in [gotchas.md](.github/icm/_shared/gotchas.md) first | a person has seen the reproduction fail |
| feature | a new tool, option or behaviour is asked for | [01_spec](.github/icm/02-feature/stages/01_spec/CONTEXT.md) | a person approves the spec |
| api-drift | memoryrelay/api added, renamed or retired a route or tool, or the alignment items are taken up | [01_spec](.github/icm/02-feature/stages/01_spec/CONTEXT.md), with the open list in [api-alignment.md](.github/icm/_shared/api-alignment.md) as the request | a person approves the spec |
| fix-to-feature | a fix turns out to need a new tool, option or API route | [01_spec](.github/icm/02-feature/stages/01_spec/CONTEXT.md), with the fix run's `reproduction.md` as the request | a person approves the spec |
| release | a version is to be published, or a merged version is missing from npm | [01_plan](.github/icm/03-release/stages/01_plan/CONTEXT.md) | a person approves the version number |
| deps | Dependabot opened a pull request, or `openclaw` is to be bumped | [01_review](.github/icm/04-deps/stages/01_review/CONTEXT.md) | a person decides to merge it or not |
| docs | a document is wrong or missing and no code has to change | [01_locate](.github/icm/05-docs/stages/01_locate/CONTEXT.md) | a person confirms each owning file |
| maintain | a fact here is past review or its evidence moved (the weekly `ICM check` is red) | [_shared/CONTEXT.md](.github/icm/_shared/CONTEXT.md): re-read each fact's evidence, fix the pointer, bump `verified_at` and `verified_commit`, run `python .github/icm/_system/generate.py` | a pull request re-verifying each fact, read by a person |
| next | a stage's output was approved | the next numbered stage of the same job | a person reads that stage's output |
| status | asked for status | scan `.github/icm/*/stages/*/output/` | report what exists |

## Agents connecting remotely

This repository has no MemoryRelay workspace of its own: the memoryrelay hub workspace `memoryrelay-hub` (memoryrelay/agent-knowledge) includes it, and the hub's mirror compiles and serves these files from `main`. An agent on a clone needs nothing: this file is the entry and the table above is the route. An agent that is not on a clone reaches the same files over MCP at `https://api.memoryrelay.net/mcp` through `memoryrelay-hub` (Claude Code and Codex with a key in `MEMORYRELAY_API_KEY`, claude.ai and Claude Desktop as a connector that signs in). None of it holds a secret.

- Start with `icm_context_build` for the route that fits, not with the whole repository.
- Report what you read with `icm_report_reads` when a stage ends, and what the task came to with `icm_report_outcome`.
- Never write through MCP: a change is a branch and a pull request here, read and merged by a person.

## Rules

- Nothing moves to the next stage until a person has read the output of the last one.
- A stage writes to its own `output/`, which is not committed: one run per worktree or branch, and clear that job's `stages/*/output/` when its pull request merges or is abandoned.
- A job reads only its own run's output; moving to another job is a route above, started by the person.
- `.github/icm/` points at the files that own each fact. When they disagree, the owning file is right: correct `.github/icm/` in the same pull request, and bump its `verified_commit`.
- A merge to `main` publishes nothing; a version reaches npm only when a person dispatches the publish.
