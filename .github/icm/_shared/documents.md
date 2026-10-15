---
verified_at: 2026-10-15
verified_commit: 889029f7ac3e335f3a462cf9671ed9efeb4ecd79
---

# Documents — which are pinned, which are history, and what has drifted

The agent-facing files are the root `CLAUDE.md` (the entry) and this `_shared/` folder. Everything else is a document a person reads; each restates facts the code owns, and the code is right when they disagree (`05-docs` corrects the document). Every document linked below is pinned as a node of its own.

## Pinned

| Document | What it answers | Owner of the facts |
|---|---|---|
| [README.md](../../../README.md) | the npm and GitHub front page: install, ICM and memory integration, the 43 tools, commands, configuration, hooks, troubleshooting, known issues | `index.ts`, `openclaw.plugin.json`, `src/tools/` |
| [CHANGELOG.md](../../../CHANGELOG.md) | every version and why; migration steps for breaking ones | the merged pull requests |
| [RELEASING.md](../../../RELEASING.md) | the release checklist, the reinstall workaround, the vector-search latency note | `package.json`, `.github/workflows/publish.yml`, `src/pipelines/recall/embed-query.ts` |

The shipped skills (`skills/*/SKILL.md`) are product, not documents: they instruct the end user's agent and change with the tools ([architecture.md](architecture.md)).

## History, not pinned

| File | What it was | Superseded by |
|---|---|---|
| `VALIDATION_REPORT_v0.12.12.md` | a manual run of 32 tools against the API on 2026-03-07 | the 0.25.0 rebuild, which removed most of those tools (`CHANGELOG.md:84`); the tests under `tests/` |
| `docs/v017-implementation-plan.md` | the plan for the local SQLite cache (epic #62) | the code in `src/cache/` and the 0.17.x entries of `CHANGELOG.md` |

## Known drift

Found on 2026-10-14 and re-checked on 2026-10-15; each is a `05-docs` run (or part of the next release) until fixed.

- `README.md:573` (Known Issues) says `agentId` must be a UUID; the API takes the agent's name ([api-alignment.md](api-alignment.md)).
- `README.md:571` (Known Issues, `openclaw status` "unavailable", "fix planned in v0.17.0") and `README.md:575-583` (Roadmap: v0.17.0) describe a release that shipped in April; superseded by `CHANGELOG.md`.
- `RELEASING.md` still says a pushed tag publishes; every version since 0.25.0 went out through the manual publish in [release.md](release.md). Which path is canonical is a person's decision.
