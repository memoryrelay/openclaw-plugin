# OpenClaw MemoryRelay Plugin

## Current Version

- **Stable**: v0.16.3
- **In development**: v0.17.0 — local SQLite cache layer, SyncDaemon, vector search via `sqlite-vec`, MemorySearchManager-compatible schema (Epic #62, issues #63–#72)

## Important Notes

- `.mcp.json` must be present in the project root for MCP tools to work in `claude --print` sessions
- `agentId` must be a UUID from `GET /v1/agents` — not a name string

## Commands

```bash
npm install          # Install dependencies
npm test             # Run tests (vitest run)
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report (v8)
```

## Architecture (v0.17 Pipeline Pattern — v0.16.3 stable, v0.17.0 in development)

- `index.ts` — Plugin entry point: wiring only (~1300 lines). Imports modules, registers hooks/tools, keeps gateway methods and CLI commands inline
- `openclaw.plugin.json` — Plugin manifest with config schema and UI hints
- `src/pipelines/types.ts` — Shared type definitions (Memory, PluginConfig, RecallStage, CaptureStage, etc.)
- `src/pipelines/runner.ts` — Generic pipeline executor (stages run in order, short-circuit on `skip`)
- `src/pipelines/recall/` — Recall pipeline (5 stages): trigger-gate → scope-resolver → search → rank → format
- `src/pipelines/capture/` — Capture pipeline (6 stages): trigger-gate → message-filter → content-strip → truncate → dedup → store
- `src/filters/` — Shared filter library: `non-interactive.ts` (trigger detection), `noise-patterns.ts` (message/boilerplate), `content-patterns.ts` (XML stripping, scope resolution)
- `src/context/` — Context layer: `request-context.ts` (immutable per-invocation context), `namespace-router.ts` (agent isolation), `session-resolver.ts` (concurrency-safe session cache)
- `src/cache/local-cache.ts` — LocalCache class: SQLite-backed local memory store (better-sqlite3), FTS5 search, TTL eviction
- `src/cache/sync-daemon.ts` — SyncDaemon class: background pull/push sync between local cache and API, exponential backoff
- `src/cache/vector.ts` — Optional sqlite-vec vector search extension loader
- `src/cache/schema.ts` — SQL schema constants, migration logic, version checks
- `src/cache/types.ts` — Cache-specific types: LocalCacheConfig, SyncState, BufferEntry, CacheStats, LocalMemory
- `src/client/memoryrelay-client.ts` — API client with scope/namespace support
- `src/hooks/` — 8 hook modules (before-agent-start, before-prompt-build, agent-end, session-lifecycle, subagent, compaction, activity, privacy)
- `src/tools/` — 9 tool modules grouped by domain (memory, session, entity, decision, pattern, project, agent, v2, health)
- `src/status-reporter.ts` — StatusReporter class for `/memory-status` CLI output
- `src/debug-logger.ts` — DebugLogger class (in-memory circular buffer, no file logging since v0.8.4)
- `src/heartbeat/daily-stats.ts` — Morning/evening heartbeat stats
- `src/onboarding/first-run.ts` — First-run detection and onboarding wizard
- `src/cli/stats-command.ts` — `openclaw memoryrelay stats` CLI command
- `skills/` — 5 SKILL.md files

## Tool Groups (42 total)

memory (9), entity (4), agent (3), session (4), decision (4), pattern (4), project (10), v2 async (3), health (1)

## Testing

- Framework: Vitest with `@vitest/coverage-v8`
- Test files: `index.test.ts`, `src/debug-logger.test.ts`, `src/status-reporter.test.ts`, `tests/pipelines/`, `tests/filters/`, `tests/context/`, `tests/integration/`
- 378 tests across 27 files
- Tests mock the OpenClaw Plugin SDK (`openclaw/plugin-sdk`) — no real API calls
- Pipeline stages are pure functions — each has independent unit tests
- Integration tests verify full recall and capture pipelines end-to-end
- Cache tests use in-memory SQLite (`:memory:`) — no disk I/O in CI

## Key Patterns

- Recall and capture are pipelines of discrete stages, each a pure function with `(input, ctx) → continue | skip`
- `RequestContext` (immutable, per-invocation) replaces shared mutable `currentSessionId`
- Session-scoped (short-term) + long-term memories with auto-scoping via `resolveScope()`
- Namespace routing: configurable agent isolation + 3 subagent policies (inherit/isolate/skip)
- Composite recall ranking: similarity + freshness + importance + tier boosts
- Tools registered via domain-grouped modules in `src/tools/` with `scope` parameter support
- Hooks registered via modules in `src/hooks/` — `before-prompt-build` delegates to recall pipeline, `agent-end` to capture pipeline
- Config resolution: env vars (`MEMORYRELAY_API_KEY`, etc.) override `openclaw.plugin.json` config values
- API calls to `api.memoryrelay.net` with bearer token auth, 30s timeout, 3 retries with exponential backoff

## Gotchas

- Plugin ID is `plugin-memoryrelay-ai` (not `memory-memoryrelay`) — wrong ID causes "No install record" errors
- `memory_batch_store` may return 500 on large batches — use individual `memory_store` as workaround
- `memory_list` limit is capped at 100 to prevent 422 errors (v0.15.6 fix)
- `logFile` config option is deprecated and ignored since v0.8.4 (security compliance)
- Onboarding state persists at `~/.openclaw/memoryrelay-onboarding.json` — not project-scoped
- `.mcp.json` must exist in project root for MCP tools to be available to the plugin
