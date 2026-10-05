# OpenClaw MemoryRelay Plugin

## Current Version

- **Stable**: v0.28.0 (ICM pinned context and memory; MemoryRelay and ICM files as corpora of OpenClaw's own memory)

## Important Notes

- `memoryrelay/api` is the source of truth for what the API serves. Its `tests/test_client_contract.py` asserts every path the in-repo clients call exists; this plugin's `tests/client/icm-client.test.ts` asserts the paths and payloads this client sends. When the API changes, both move.
- The `icm` tool group (22 tools) mirrors `@memoryrelay/mcp-server` (`mcp/src/server.ts` and `mcp/src/icm-agent.ts` in memoryrelay/api) name for name. Change a tool there first, then here.
- The API has no sessions, decisions, patterns, projects, `/v1/embed` or `/v1/quota`. Do not add a tool that calls them; `scope` and `session_id` are memory metadata, filtered with `metadata_filter`.
- `agentId` is an agent **name** (e.g. `iris`), the API resolves it; `GET /v1/memories` caps `limit` at 50.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Transpile index.ts + src/ to dist/ (ESM)
npm run typecheck    # tsc --noEmit (not CI-enforced yet — known SDK type errors)
npm test             # Run tests (vitest run)
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report (v8)
```

## Build & Packaging

- The package **must** ship compiled JS. OpenClaw >= 2026.7.1 refuses to install a plugin whose entry point is a `.ts` file and aborts the whole gateway startup migration — see #138.
- `main` and `openclaw.extensions` point at `./dist/index.js`; `dist/` is in `files` and gitignored.
- `scripts/build.mjs` is transpile-only (`ts.transpileModule`) and mirrors the source tree: `index.ts` → `dist/index.js`, `src/x.ts` → `dist/src/x.js`. It does **not** type check, so `npm run build` stays green while the SDK type errors are worked through.
- Relative imports must carry an explicit `.js` extension — Node's ESM resolver rejects extensionless specifiers in the compiled output even though vitest tolerates them in source.
- Anything resolved from `import.meta.url` must work both from the package root (source) and from `dist/` (compiled).

## Architecture

- `index.ts` — Plugin entry point: wiring only. Imports modules, registers hooks/tools, keeps gateway methods and CLI commands inline
- `openclaw.plugin.json` — Plugin manifest with config schema and UI hints
- `src/client/memoryrelay-client.ts` — API client: memory, entities, agents, V2 async, and the `/v2/icm` methods (`icm*`, `IcmApiError`)
- `src/tools/icm-tools.ts` — The 22 ICM tools: catalogue (`ICM_TOOLS`), dispatch (`callIcmTool`), registration with the `icm_unsupported` guard
- `src/tools/` — memory, entity, agent, v2, health tool modules
- `src/memory/corpus-supplement.ts` — MemoryRelay as a corpus of OpenClaw's own memory: `registerMemoryCorpusSupplement` (search + `memoryrelay:<id>` reads behind memory-core's `memory_search`/`memory_get` with `corpus="all"`), `combineCorpusSupplements`, and `registerMemoryPromptSupplement`
- `src/memory/icm-corpus.ts` — ICM workspace files as a corpus (`icm:<workspace>/<file>`): search on the server (`GET /v2/icm/search`); reads from the live release fetched as a zip (`src/memory/zip.ts`) and cached on disk by release id, which is also the local BM25 fallback when the server has no search route (404) or a call fails
- `src/hooks/before-agent-start.ts` — Pinned context: `icm_context_for` for the configured repo/step, prepended with its receipt; then the workflow block
- `src/hooks/before-prompt-build.ts` — Delegates to the recall pipeline (memory as evidence)
- `src/hooks/agent-end.ts` — Delegates to the capture pipeline
- `src/pipelines/types.ts` — Shared type definitions (Memory, PluginConfig, IcmConfig, RecallStage, CaptureStage, etc.)
- `src/pipelines/runner.ts` — Generic pipeline executor (stages run in order, short-circuit on `skip`)
- `src/pipelines/recall/` — Recall pipeline (6 stages): trigger-gate → scope-resolver → embed-query → search → rank → format
- `src/pipelines/capture/` — Capture pipeline (6 stages): trigger-gate → message-filter → content-strip → truncate → dedup → store
- `src/filters/` — Shared filter library: `non-interactive.ts` (trigger detection), `noise-patterns.ts`, `content-patterns.ts` (XML stripping, scope resolution)
- `src/context/` — `request-context.ts` (immutable per-invocation context), `namespace-router.ts` (agent isolation)
- `src/cache/` — Local SQLite cache (better-sqlite3, FTS5, optional sqlite-vec), sync daemon, nomic local embeddings
- `src/status-reporter.ts`, `src/debug-logger.ts`, `src/heartbeat/daily-stats.ts`, `src/onboarding/first-run.ts`, `src/cli/stats-command.ts`
- `skills/` — 3 SKILL.md files: `icm-context`, `memory-workflow`, `entity-and-context`

## Tool Groups (41 total)

icm (22), memory (8), entity (4), agent (3), v2 async (3), health (1)

## Testing

- Framework: Vitest with `@vitest/coverage-v8`
- Tests mock the OpenClaw Plugin SDK (`openclaw/plugin-sdk`) — no real API calls; the client tests stub `fetch`
- Pipeline stages are pure functions — each has independent unit tests
- Cache tests use in-memory SQLite (`:memory:`); they need the `better-sqlite3` binding, which `postinstall` installs

## Key Patterns

- Pinned context first, memory as evidence: the agent-start hook never substitutes recall for a missing binding, and a blocked build pins nothing
- Recall and capture are pipelines of discrete stages, each a pure function with `(input, ctx) → continue | skip`
- `RequestContext` (immutable, per-invocation); the OpenClaw session key is the session id
- Namespace routing: configurable agent isolation + 3 subagent policies (inherit/isolate/skip)
- Config resolution: env vars (`MEMORYRELAY_API_KEY`, `MEMORYRELAY_ICM_REPO`, ...) override `openclaw.plugin.json` config values
- API calls to `api.memoryrelay.net` with bearer token auth, 30s timeout, 3 retries with exponential backoff

## Gotchas

- OpenClaw keeps **one corpus supplement per plugin** (a later registration replaces the earlier by plugin id). Every source goes through `combineCorpusSupplements`; never call `registerMemoryCorpusSupplement` twice.

- The manifest has no `kind`: a single-kind `memory` plugin is disabled whenever another plugin holds the memory slot, and this one never registered a memory capability, so claiming the slot only pushed memory-core aside. memory-core keeps the slot; this plugin supplements it. `memory_get` is memory-core's (OpenClaw keeps the first registration of a tool name).
- Plugin ID is `plugin-memoryrelay-ai` (not `memory-memoryrelay`) — wrong ID causes "No install record" errors
- `memory_batch_store` may return 500 on large batches — use individual `memory_store` as workaround
- `logFile` config option is deprecated and ignored since v0.8.4 (security compliance)
- Onboarding state persists at `~/.openclaw/memoryrelay-onboarding.json` — not project-scoped
