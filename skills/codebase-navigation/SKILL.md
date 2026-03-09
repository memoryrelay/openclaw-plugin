---
name: codebase-navigation
description: "Use when navigating the openclaw-plugin codebase for the first time, looking for where a tool is registered, understanding the monolithic index.ts structure, or adding a new tool or hook."
---

# Codebase Navigation

The plugin is a single monolithic `index.ts` (4320 lines) plus a few extracted modules.

## index.ts File Map

| Lines | Section |
|-------|---------|
| 1--14 | Header comments and version info |
| 16--36 | Imports (plugin SDK, heartbeat, CLI stats, onboarding) |
| 38--47 | Constants (`DEFAULT_API_URL`, `REQUEST_TIMEOUT_MS`, `MAX_RETRIES`) |
| 48--121 | `DebugLogger` class (inlined) with `LogEntry`, `DebugLoggerConfig` |
| 123--404 | `StatusReporter` class (inlined) with `ToolStatus`, `ConnectionStatus`, `MemoryStats` |
| 406--461 | Types: `AutoCaptureConfig`, `MemoryRelayConfig`, `Memory`, `SearchResult`, `Stats` |
| 463--610 | Utility functions: `sleep`, `isRetryableError`, `fetchWithTimeout`, auto-capture helpers |
| 612--1255 | `MemoryRelayClient` class (API client with retry logic, all endpoints) |
| 1256--1275 | Pattern detection for auto-capture (`CAPTURE_PATTERNS`, `shouldCapture`) |
| 1277--1524 | Plugin entry: `export default async function plugin(api)`, config resolution, client init |
| 1525--1565 | `TOOL_GROUPS` map and `isToolEnabled()` |
| 1567--3673 | 39 tool registrations |
| 3675--3779 | CLI commands (`memoryrelay status/stats/list/export`) |
| 3781--3908 | `before_agent_start` hook (workflow instructions + auto-recall) |
| 3910--3971 | `agent_end` hook (auto-capture) |
| 3977--4009 | First-run onboarding |
| 4011--4320 | Gateway methods (`memoryrelay.logs`, `.health`, `.metrics`, `.heartbeat`, `.onboarding`, `.stats`, `.test`) |

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

## TOOL_GROUPS (line 1526)

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
