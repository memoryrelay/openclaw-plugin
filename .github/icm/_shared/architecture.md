---
verified_at: 2026-10-14
verified_commit: a9cb4d0f2f69bc260e7797c622e4dda7c55bd2b7
---

# Architecture — the map of the plugin

What each part is and which file owns it. Follow the pointer for the detail; when this file and the code disagree, the code is right.

## Entry and manifest

- `index.ts` — the plugin entry, wiring only: reads config (`index.ts:313-391`), builds the client, registers hooks (`index.ts:512-514` and the `register*Hooks` calls) and tools (`index.ts:524-530`), joins the memory corpora (`index.ts:546-568`), starts the MEMORY.md mirror on `gateway_start` (`index.ts:579`); gateway methods and `/memory-*` commands stay inline. Its JSDoc header (`index.ts:1-15`) is stale, see [gotchas.md](gotchas.md).
- `openclaw.plugin.json` — the manifest: `id`, config schema and UI hints, and `contracts.tools` (`openclaw.plugin.json:6`), which must name every tool the plugin registers.
- `package.json` — `main` and `openclaw.extensions` point at the compiled `dist/index.js`; build and test scripts in [build-and-test.md](build-and-test.md).

## Tools: 41 in six groups

The groups and their names are `TOOL_GROUPS` (`index.ts:234-245`): memory 8, entity 4, agent 3, health 1, v2 async 3, icm 22. One module per group under `src/tools/`:

- `src/tools/icm-tools.ts` — the ICM catalogue `ICM_TOOLS` (`src/tools/icm-tools.ts:37`), dispatch `callIcmTool` (`:323`), registration with the `icm_unsupported` guard (`:592`). Which names it must carry: [api-alignment.md](api-alignment.md).
- `src/tools/memory-tools.ts`, `src/tools/entity-tools.ts`, `src/tools/agent-tools.ts`, `src/tools/v2-tools.ts`, `src/tools/health-tools.ts`.

## The API client

`src/client/memoryrelay-client.ts` is the only HTTP client: memory, entities, agents, v2 async, and the `/v2/icm` methods (`icm*`, `IcmApiError`). Base URL, timeout and retries at `src/client/memoryrelay-client.ts:16-18`; the request loop at `:232`.

## Hooks (OpenClaw lifecycle)

- `src/hooks/before-agent-start.ts` — pinned context: `icm_context_for` for the configured repo and step, prepended with its receipt, then the workflow block. It listens on `before_prompt_build` (`src/hooks/before-agent-start.ts:117`) despite its file name.
- `src/hooks/before-prompt-build.ts` — runs the recall pipeline (memory as evidence).
- `src/hooks/agent-end.ts` — runs the capture pipeline.
- `src/hooks/activity.ts`, `src/hooks/privacy.ts`, `src/hooks/compaction.ts`, `src/hooks/subagent.ts` — tool activity, redaction before persistence, compaction and reset, subagent spawn and end.

## Pipelines

- `src/pipelines/runner.ts` — the executor: stages in order, short-circuit on `skip`. Shared types (`PluginConfig`, `IcmConfig`, stage types) in `src/pipelines/types.ts`.
- `src/pipelines/recall/index.ts` — six stages: trigger-gate, scope-resolver, embed-query, search, rank, format.
- `src/pipelines/capture/index.ts` — six stages: trigger-gate, message-filter, content-strip, truncate, dedup, store.
- `src/filters/` (trigger detection, noise and content patterns) and `src/context/` (`request-context.ts`, `namespace-router.ts`) serve both. Decision saliency scoring: `src/saliency/scorer.ts`.

## OpenClaw memory corpora

- `src/memory/corpus-supplement.ts` — MemoryRelay as a corpus behind memory-core's `memory_search`/`memory_get`, `combineCorpusSupplements` (`src/memory/corpus-supplement.ts:165`), the prompt supplement.
- `src/memory/icm-corpus.ts` — ICM workspace files as a corpus: server search, release zip (`src/memory/zip.ts`) cached on disk by release id, local fallback.
- `src/memory/memory-md-sync.ts` — the opt-in MEMORY.md write-back with secret redaction (`redactSecrets`, `src/memory/memory-md-sync.ts:59`).

## Local cache and the rest

- `src/cache/` — SQLite cache (`src/cache/local-cache.ts`), sync daemon (`src/cache/sync-daemon.ts`), local nomic embeddings (`src/cache/nomic-embedding-service.ts`), optional sqlite-vec (`src/cache/vector.ts`).
- `src/status-reporter.ts`, `src/debug-logger.ts`, `src/heartbeat/daily-stats.ts`, `src/onboarding/first-run.ts`, `src/cli/stats-command.ts`.
- `skills/` — three OpenClaw skills shipped in the package for the end user's agent (not for agents working on this repository): `skills/icm-context/SKILL.md`, `skills/memory-workflow/SKILL.md`, `skills/entity-and-context/SKILL.md`.
- `scripts/` — `scripts/build.mjs` and the install hooks `scripts/preinstall.cjs`, `scripts/postinstall.cjs`.
