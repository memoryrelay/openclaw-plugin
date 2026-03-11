---
name: codebase-navigation
description: "Use when navigating the openclaw-plugin codebase for the first time, looking for where a tool is registered, understanding the monolithic index.ts structure, or adding a new tool or hook."
---

# Codebase Navigation

The plugin is a single monolithic `index.ts` (4839 lines) plus a few extracted modules.

## index.ts File Map

| Lines | Section |
|-------|---------|
| 1--14 | Header comments and version info |
| 16--36 | Imports (plugin SDK, heartbeat, CLI stats, onboarding) |
| 38--47 | Constants (`DEFAULT_API_URL`, `REQUEST_TIMEOUT_MS`, `MAX_RETRIES`) |
| 48--121 | `DebugLogger` class (inlined) with `LogEntry`, `DebugLoggerConfig` |
| 123--404 | `StatusReporter` class (inlined) with `ToolStatus`, `ConnectionStatus`, `MemoryStats` |
| 406--461 | Types: `AutoCaptureConfig`, `MemoryRelayConfig`, `Memory`, `SearchResult`, `Stats` |
| 463--648 | Utility functions: `sleep`, `isRetryableError`, `fetchWithTimeout`, auto-capture helpers, `redactSensitive`, `extractRescueContent` |
| 650--1294 | `MemoryRelayClient` class (API client with retry logic, all endpoints) |
| 1296--1315 | Pattern detection for auto-capture (`CAPTURE_PATTERNS`, `shouldCapture`) |
| 1317--1562 | Plugin entry: `export default async function plugin(api)`, config resolution, client init, session cache, `touchSession` |
| 1564--1613 | `TOOL_GROUPS` map and `isToolEnabled()` |
| 1615--3747 | 39 tool registrations |
| 3749--3853 | CLI commands (`memoryrelay status/stats/list/export`) |
| 3855--4240 | 14 lifecycle hooks (`before_agent_start`, `agent_end`, `session_start`, `session_end`, `before_tool_call`, `after_tool_call`, `before_compaction`, `before_reset`, `message_received`, `message_sending`, `before_message_write`, `subagent_spawned`, `subagent_ended`, `tool_result_persist`) |
| 4242--4274 | First-run onboarding |
| 4276--4586 | Gateway methods (`memoryrelay.logs`, `.health`, `.metrics`, `.heartbeat`, `.onboarding`, `.stats`, `.test`) |
| 4588--4790 | Direct commands: `/memory-status`, `/memory-stats`, `/memory-health`, `/memory-logs`, `/memory-metrics` |
| 4792--4839 | Stale session cleanup service (`memoryrelay-session-cleanup` via `api.registerService`) |

## Tool Registration Pattern

Every tool follows this pattern:

```typescript
if (isToolEnabled("tool_name")) {
  api.registerTool((ctx) => ({
    name: "tool_name",
    description: "...",
    parameters: { /* JSON schema */ },
    execute: async (_id, args) => { /* impl */ }
  }), { name: "tool_name" });
}
```

Tools are numbered 1--39 with comment markers (e.g., `// 1. memory_store`). Search for `// N.` to jump to a specific tool.

## TOOL_GROUPS (line 1569)

| Group | Count | Tools |
|-------|-------|-------|
| memory | 9 | `memory_store`, `memory_recall`, `memory_forget`, `memory_list`, `memory_get`, `memory_update`, `memory_batch_store`, `memory_context`, `memory_promote` |
| entity | 4 | `entity_create`, `entity_link`, `entity_list`, `entity_graph` |
| agent | 3 | `agent_list`, `agent_create`, `agent_get` |
| session | 4 | `session_start`, `session_end`, `session_recall`, `session_list` |
| decision | 4 | `decision_record`, `decision_list`, `decision_supersede`, `decision_check` |
| pattern | 4 | `pattern_create`, `pattern_search`, `pattern_adopt`, `pattern_suggest` |
| project | 10 | `project_register`, `project_list`, `project_info`, `project_add_relationship`, `project_dependencies`, `project_dependents`, `project_related`, `project_impact`, `project_shared_patterns`, `project_context` |
| health | 1 | `memory_health` |

The `enabledTools` config option accepts a comma-separated list of group names (or `"all"`).

## Supporting Modules

| File | Purpose |
|------|---------|
| `src/debug-logger.ts` | `DebugLogger` class (source of the inlined copy) |
| `src/status-reporter.ts` | `StatusReporter` class (source of the inlined copy) |
| `src/heartbeat/daily-stats.ts` | Morning/evening summaries, `calculateStats`, `formatStatsForDisplay` |
| `src/onboarding/first-run.ts` | Onboarding wizard: `checkFirstRun`, `runSimpleOnboarding` |
| `src/cli/stats-command.ts` | CLI `stats` command handler |

## Configuration Fallback Chain

```
Plugin config (openclaw.json) -> Env vars -> Defaults
```

- `apiKey`: `cfg.apiKey` -> `MEMORYRELAY_API_KEY` (required, no default)
- `agentId`: `cfg.agentId` -> `MEMORYRELAY_AGENT_ID` -> `api.agentName`
- `apiUrl`: `cfg.apiUrl` -> `MEMORYRELAY_API_URL` -> `https://api.memoryrelay.net`

## Key Types

| Type | Location | Purpose |
|------|----------|---------|
| `Memory` | L442 | Core memory record (`id`, `content`, `agent_id`, `metadata`, `entities`) |
| `SearchResult` | L453 | Vector search hit (`memory`, `score`) |
| `Stats` | L458 | Agent statistics (`total_memories`, `last_updated`) |
| `LogEntry` | L52 | Debug log entry (tool, method, path, duration, status) |
| `DebugLoggerConfig` | L66 | Logger settings (enabled, verbose, maxEntries) |
| `ConnectionStatus` | L140 | API connection state (status, endpoint, responseTime) |
| `ToolStatus` | L127 | Per-group tool health (enabled, available, failed) |

## Key Helpers

| Function | Location | Purpose |
|----------|----------|---------|
| `redactSensitive` | L591 | Replace blocklist patterns with `[REDACTED]` |
| `extractRescueContent` | L608 | Salvage assistant messages before compaction/reset |
| `touchSession` | L1444 | Update `lastActivityAt` timestamp in session cache |
| `isToolEnabled` | L1605 | Check if a tool's group is in the enabled set |
| `shouldCapture` | L1310 | Test text against `CAPTURE_PATTERNS` for auto-capture |
