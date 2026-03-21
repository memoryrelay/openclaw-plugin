# OpenClaw MemoryRelay Plugin

## Commands

```bash
npm install          # Install dependencies
npm test             # Run tests (vitest run)
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report (v8)
```

## Architecture

- `index.ts` — Monolithic plugin entry point: registers 42 tools, 14 lifecycle hooks, and CLI subcommands. Contains inlined DebugLogger class (duplicated from src/debug-logger.ts) and all tool/hook handler logic
- `openclaw.plugin.json` — Plugin manifest with config schema and UI hints
- `src/status-reporter.ts` — StatusReporter class for `/memory-status` CLI output
- `src/debug-logger.ts` — DebugLogger class (in-memory circular buffer, no file logging since v0.8.4)
- `src/heartbeat/daily-stats.ts` — Morning/evening heartbeat stats (calculateStats, morningCheck, eveningReview)
- `src/onboarding/first-run.ts` — First-run detection and onboarding wizard (state stored in `~/.openclaw/memoryrelay-onboarding.json`)
- `src/cli/stats-command.ts` — `openclaw memoryrelay stats` CLI command (text/JSON output)
- `skills/` — 5 SKILL.md files: memory-workflow, decision-tracking, pattern-management, project-orchestration, entity-and-context

## Tool Groups (42 total)

memory (9), entity (4), agent (3), session (4), decision (4), pattern (4), project (10), v2 async (3), health (1)

## Testing

- Framework: Vitest with `@vitest/coverage-v8`
- Test files: `index.test.ts`, `src/debug-logger.test.ts`, `src/status-reporter.test.ts`
- Tests mock the OpenClaw Plugin SDK (`openclaw/plugin-sdk`) — no real API calls

## Key Patterns

- All 42 tools registered inline in `index.ts` via `api.registerTool()` with callback pattern
- 14 hooks registered via `api.on()` (before_agent_start, agent_end, session_start/end, etc.)
- CLI subcommands under `openclaw memoryrelay <cmd>` (status, stats, list, search)
- Config resolution: env vars (`MEMORYRELAY_API_KEY`, etc.) override `openclaw.plugin.json` config values
- API calls to `api.memoryrelay.net` with bearer token auth, 30s timeout, 3 retries with exponential backoff

## Gotchas

- Plugin ID is `plugin-memoryrelay-ai` (not `memory-memoryrelay`) — wrong ID causes "No install record" errors
- `memory_batch_store` may return 500 on large batches — use individual `memory_store` as workaround
- `memory_context` returns 405 on some API versions — use `memory_recall` instead
- `memory_list` limit is capped at 100 to prevent 422 errors (v0.15.6 fix)
- DebugLogger is duplicated: inlined in `index.ts` AND in `src/debug-logger.ts` — keep both in sync
- `logFile` config option is deprecated and ignored since v0.8.4 (security compliance)
- Onboarding state persists at `~/.openclaw/memoryrelay-onboarding.json` — not project-scoped
