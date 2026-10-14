---
verified_at: 2026-10-14
verified_commit: a9cb4d0f2f69bc260e7797c622e4dda7c55bd2b7
---

# Documents — which are pinned, which are history, and what has drifted

The agent-facing files are the root `CLAUDE.md` (the entry) and this `_shared/` folder. Everything else is a document a person reads; each restates facts the code owns, and the code is right when they disagree (`05-docs` corrects the document). Every document linked below is pinned as a node of its own.

## Pinned

| Document | What it answers | Owner of the facts |
|---|---|---|
| [README.md](../../../README.md) | the npm and GitHub front page: install, ICM and memory integration, the 41 tools, commands, configuration, hooks, troubleshooting, known issues | `index.ts`, `openclaw.plugin.json`, `src/tools/` |
| [CHANGELOG.md](../../../CHANGELOG.md) | every version and why; migration steps for breaking ones | the merged pull requests |
| [RELEASING.md](../../../RELEASING.md) | the release checklist, the reinstall workaround, the vector-search latency note | `package.json`, `.github/workflows/publish.yml`, `src/pipelines/recall/embed-query.ts` |

The shipped skills (`skills/*/SKILL.md`) are product, not documents: they instruct the end user's agent and change with the tools ([architecture.md](architecture.md)).

## History, not pinned

| File | What it was | Superseded by |
|---|---|---|
| `VALIDATION_REPORT_v0.12.12.md` | a manual run of 32 tools against the API on 2026-03-07 | the 0.25.0 rebuild, which removed most of those tools (`CHANGELOG.md:77`); the tests under `tests/` |
| `docs/v017-implementation-plan.md` | the plan for the local SQLite cache (epic #62) | the code in `src/cache/` and the 0.17.x entries of `CHANGELOG.md` |

## Known drift

Found on 2026-10-14; each is a `05-docs` run (or part of the next release) until fixed.

- `README.md:571` (Known Issues) says `agentId` must be a UUID; the API takes the agent's name ([api-alignment.md](api-alignment.md)).
- `README.md:569` (Known Issues, `openclaw status` "unavailable", "fix planned in v0.17.0") and `README.md:573-581` (Roadmap: v0.17.0) describe a release that shipped in April; superseded by `CHANGELOG.md`.
- `RELEASING.md` still says a pushed tag publishes and lists a startup log literal that no longer exists; superseded by the manual publish in [release.md](release.md).
- `.github/workflows/ci-cd.yml:117` writes release notes for `@memoryrelay/openclaw-plugin`; the package is `@memoryrelay/plugin-memoryrelay-ai` (`package.json:2`).
