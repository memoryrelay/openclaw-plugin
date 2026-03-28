# Changelog

All notable changes to the OpenClaw plugin for MemoryRelay will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.16.0] - 2026-03-28

### Added
- **Pipeline architecture**: Decomposed monolithic `index.ts` (5,716 lines) into recall pipeline (5 stages) and capture pipeline (6 stages) with shared filter library
- **Session-scoped memories**: Dual-scope system (session + long-term) with auto-scoping via `resolveScope()`. Session memories tied to MemoryRelay sessions via `SessionResolver`
- **Namespace routing**: Configurable agent isolation (`isolateAgents`) and subagent policies (`inherit`, `isolate`, `skip`)
- **Non-interactive trigger detection**: Shared gate skipping cron, heartbeat, automation, and system triggers for both pipelines
- **Precision-first noise filtering**: Multi-stage capture pipeline with message-level drop, boilerplate density scoring, content stripping, and truncation
- **Composite recall ranking**: Semantic similarity + freshness boost + importance boost + tier boost, all configurable
- **Concurrency-safe request context**: Immutable `RequestContext` per invocation replaces shared mutable `currentSessionId`
- **Session resolver**: Thread-safe session cache with in-flight deduplication, stale cleanup, and LRU eviction (max 1000 entries)
- **`scope` parameter** on `memory_store`, `memory_recall`, and `memory_list` tools (`"session"`, `"long-term"`, `"all"`)
- **`namespace` and `ranking` config sections** in plugin manifest with UI hints
- **8 hook modules** extracted to `src/hooks/`
- **9 tool modules** extracted to `src/tools/` grouped by domain
- **API client module** at `src/client/memoryrelay-client.ts` with scope/namespace search support
- 256 tests across 23 files (up from 167 across 7 files)

### Changed
- `index.ts` reduced from 5,716 to ~1,300 lines (wiring only)
- Auto-recall (`before_prompt_build`) now delegates to recall pipeline
- Auto-capture (`agent_end`) now delegates to capture pipeline
- Capture tier now affects max memories stored: conservative=1, smart=3, aggressive=5
- User-Agent header updated to v0.16.0
- GitHub Actions CI upgraded from Node.js 20 to Node.js 22 (test matrix: 22.x + 24.x)

### Fixed
- Unified duplicate `Memory` type (string vs number `created_at`)
- Dedup search now respects namespace isolation
- `webhook_url` parameter in `memory_store_async` now correctly forwarded to API
- `memory_list` `scope` parameter now forwarded to API
- Session cache bounded with LRU eviction to prevent memory leaks
- Global regex patterns converted to factories to prevent stateful `g`-flag bugs

## [0.15.8] - 2026-03-27

### Added
- **`before_prompt_build` hook**: Auto-recall memories before every LLM turn via new `before_prompt_build` hook, not just at session start (#51)

### Changed
- `before_agent_start` hook now only injects workflow instructions; auto-recall logic moved to `before_prompt_build`
- Version log updated from v0.15.6 to v0.15.8

## [0.15.6] - 2026-03-21

### Fixed
- `client.list()` now caps limit to 100 to avoid 422 validation errors from the API when `/memory-stats` and other commands requested limit=1000 (#49)

## [0.15.5] - 2026-03-21

### Fixed
- `stats()` method now calls correct API endpoint `/v1/agents/{agent_id}/stats` instead of non-existent `/v1/stats?agent_id=...` which returned 404 (#47, #49)
- All hardcoded version strings updated to 0.15.5 (header, User-Agent, startup log, currentVersion, plugin manifest)
- Merged stats endpoint fix to main branch (was only on feature branch in v0.15.4 release)

## [0.15.3] - 2026-03-19

### Fixed
- **CRITICAL:** `memory_list` and `memory_forget` now display full UUIDs instead of truncated 8-char hex IDs, fixing 422 validation errors when using listed IDs with `memory_get`/`memory_forget` (#43)
- **HIGH:** `subagent_ended` hook no longer unconditionally stores every completion event as a memory. Storage is now gated behind `autoCapture` config, respects the blocklist, and skips routine `ok`/`success` outcomes — only failures and unusual outcomes are persisted (#44)

## [0.15.2] - 2026-03-18

### Fixed
- Stale version header in index.ts (was 0.13.0, now 0.15.2) (#38)
- Runtime TypeError in `memoryrelay.logs` gateway: `l.level`/`l.message` replaced with actual `LogEntry` fields (#39)
- Type mismatch in `src/status-reporter.ts`: `PluginConfig.autoCapture` synced from `boolean` to `AutoCaptureConfig` (#41)
- Missing `logFile?` field in inlined `DebugLoggerConfig` interface (#41)
- Stale tool count comment (39 → 42) (#41)

## [0.15.1] - 2026-03-17

### Added
- New direct command: `/memory-update` — shows correct plugin update command
- Total direct commands: 17 (was 16)
- "Updating" section in README with correct plugin ID and workflow

### Fixed
- Documented that plugin ID for updates is `plugin-memoryrelay-ai` (not `memory-memoryrelay`)

## [0.15.0] - 2026-03-17

### Added
- 3 V2 async tools: `memory_store_async`, `memory_status`, `context_build`
- Total tools: 42 (was 39), 9 groups (was 8)
- New direct command: `/memory-context` — build ranked context bundles
- Total direct commands: 16 (was 15)

### Fixed
- Startup log now shows dynamic tool count (was hardcoded "39 tools")
- Startup log version updated (was stuck at v0.13.0)
- User-Agent header updated to v0.15.0 (was v0.13.0)

### Changed
- README updated with V2 tools, comparison table, correct counts
- MCP server README aligned with competitive positioning

## [0.14.0] - 2026-03-17

### Added
- 10 new direct commands: `/memory-search`, `/memory-validate`, `/memory-config`, `/memory-sessions`, `/memory-decisions`, `/memory-patterns`, `/memory-entities`, `/memory-projects`, `/memory-agents`, `/memory-forget`
- Total direct commands: 15 (was 5)
- Competitive positioning in README (vs Mem0, vs OpenClaw-Projects)
- Use case documentation (Tech Lead, DevOps, Solo Dev, Coding Agent)
- Full command reference with examples
- Architecture and privacy documentation

### Fixed
- Config schema `autoCapture` now supports full object shape (was boolean-only)
- Config schema `autoCapture` default corrected to `true` (was `false`, mismatched code)
- Added missing uiHints for `recallLimit`, `recallThreshold`, `debug`, `verbose`, `maxLogEntries`

### Changed
- README rewritten with competitive analysis, quick start, and complete feature reference
- Plugin description updated to reflect 15 commands
- Version bumped to 0.14.0

## [0.13.0] - 2026-03-10

### Added
- **Direct Commands**: `/memory-status`, `/memory-stats`, `/memory-health`, `/memory-logs`, `/memory-metrics` for instant status without LLM
- **Session Sync Hooks**: Auto-create/end MemoryRelay sessions when OpenClaw sessions start/end
- **Compaction Rescue**: Automatically save key context before messages are lost to compaction
- **Session Reset Rescue**: Save context before session reset/clear
- **Tool Observation Hooks**: Track tool call activity for session freshness and debug metrics
- **Message Privacy Redaction**: Auto-redact sensitive data (passwords, credit cards, SSNs) before message persistence
- **Tool Result Redaction**: Apply privacy blocklist to tool results before persistence
- **Subagent Tracking**: Store memories when subagents complete, tracking multi-agent collaboration
- **Sender Identity Tagging**: Auto-inject `sender_id` into memory metadata from tool context
- **Stale Session Cleanup Service**: Background service auto-closes inactive sessions (configurable timeout)
- **Config Options**: `sessionTimeoutMinutes`, `sessionCleanupIntervalMinutes` for session management
- **Plugin Skills**: 8 specialized skills for agent workflow guidance and developer onboarding

### Changed
- Session cache upgraded from simple string map to track `lastActivityAt` timestamps
- OpenClaw SDK alignment: now uses 14 lifecycle hooks (up from 2), 5 direct commands, 1 background service

## [0.12.11] - 2026-03-07

### Added
- **External Session IDs**: New `getOrCreateSession()` client method calls `POST /v1/sessions/get-or-create`
- **Session Cache**: In-memory cache maps `external_id` to MemoryRelay session UUID for efficient lookups
- **Auto-Session Creation**: Sessions auto-created from project slug or workspace directory context
- **Multi-Agent Collaboration**: Multiple agents sharing a project slug share the same session
- **`session_id` parameter**: `memory_store` accepts optional explicit session UUID

### Fixed
- **Removed ctx.sessionId auto-injection**: Was causing HTTP 400 errors when OpenClaw session ID was sent as MemoryRelay session ID

### Changed
- Session ID injection priority: explicit `session_id` > context session (project/workspace) > no session
- `memory_store` response now includes `session_id` in details when a session is active

## [0.12.8] - [0.12.10] (Patch Releases, 2026-03-06)

### Fixed
- **v0.12.8**: Removed extra closing parentheses from `toolTests` array
- **v0.12.9**: Fixed version string in runtime log message
- **v0.12.10**: Updated version string to v0.12.10 in log message

## [0.12.7] - 2026-03-06

### Fixed
- **Session Tracking**: All 39 tools converted from direct registration to factory pattern for proper context access
- `ctx.sessionId` now properly captured via factory closure

### Changed
- Tools registered via `api.registerTool((ctx) => tool)` instead of direct objects

## [0.12.3] - 2026-03-06

### Fixed
- **Session-Memory Linking**: Extract `session_id` from metadata and pass as top-level API parameter
- Memories now correctly link to sessions in database

## [0.12.0] - 2026-03-06

### Added
- **Smart Auto-Capture**: Tier-based privacy system with 4 capture modes (off/conservative/smart/aggressive)
- **Privacy Blocklist**: Automatic filtering of passwords, SSNs, credit cards, API keys
- **Daily Memory Stats**: Morning/evening summaries via `memoryrelay:heartbeat` gateway method
- **CLI Stats Command**: `memoryrelay:stats` gateway method with text/JSON output
- **First-Run Onboarding**: Welcome wizard with `memoryrelay:onboarding` gateway method
- **Modular Architecture**: `src/` directory with heartbeat, cli, and onboarding modules

### Changed
- `autoCapture` config accepts boolean (backward compat) or object with tier system

## [0.8.0] - 2026-03-05

### Added
- **Debug Logging**: DebugLogger class with circular buffer and configurable `maxLogEntries`
- **Status Reporting**: StatusReporter class with comprehensive plugin status reports
- **Gateway Methods**: `memoryrelay.logs`, `memoryrelay.health`, `memoryrelay.test`, `memoryrelay.metrics`
- **Performance Metrics**: Per-tool call count, success rate, average duration, p95/p99 latencies
- **Config Options**: `debug`, `verbose`, `logFile`, `maxLogEntries`

## [0.7.0] - 2026-03-05

### Added
- **39 Tools**: Full MemoryRelay API surface (up from 3)
- **Session Tracking**: `session_start`, `session_end`, `session_recall`, `session_list`
- **Decision Records**: `decision_record`, `decision_list`, `decision_supersede`, `decision_check`
- **Pattern Library**: `pattern_create`, `pattern_search`, `pattern_adopt`, `pattern_suggest`
- **Project Management**: 10 project tools including relationships, impact analysis, shared patterns, context loading
- **Agent Workflow**: Instructions injected via `before_agent_start` hook
- **Tool Group Filtering**: `enabledTools` config
- **Default Project**: `defaultProject` config for automatic project scoping

## [0.6.2] - 2026-03-01

### Fixed
- **OpenClaw 2026.2.26 Compatibility**: Changed `"extensions": ["./"]` to `"extensions": ["./index.ts"]`

## [0.6.0] - 2026-02-18

### Added
- Retry logic with exponential backoff (3 attempts)
- Request timeout (30 seconds)
- Environment variable fallback support
- Channel filtering (`excludeChannels` config)

## [0.4.1] - 2026-02-13

### Fixed
- Added `safety` declaration to plugin manifest to resolve false-positive security warning

## [0.4.0] - 2026-02-13

### Added
- Status reporting via `memory.status` gateway RPC method
- Memory count reporting via `/v1/stats` API endpoint

## [0.1.0] - 2026-02-12

### Added
- Initial release
- Three AI agent tools: `memory_store`, `memory_recall`, `memory_forget`
- Auto-recall lifecycle hook
- Auto-capture lifecycle hook
- Semantic search with configurable threshold
- Multi-agent support with isolated namespaces

[Unreleased]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.16.0...HEAD
[0.16.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.15.8...v0.16.0
[0.15.8]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.15.6...v0.15.8
[0.15.6]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.15.5...v0.15.6
[0.15.5]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.15.3...v0.15.5
[0.15.2]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.15.1...v0.15.2
[0.15.1]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.12.11...v0.13.0
[0.12.11]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.12.10...v0.12.11
[0.12.10]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.12.9...v0.12.10
[0.12.9]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.12.8...v0.12.9
[0.12.8]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.12.7...v0.12.8
[0.12.7]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.12.3...v0.12.7
[0.12.3]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.12.0...v0.12.3
[0.12.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.8.0...v0.12.0
[0.8.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.6.0...v0.6.2
[0.6.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.4.1...v0.6.0
[0.4.1]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.1.0...v0.4.0
[0.1.0]: https://github.com/memoryrelay/openclaw-plugin/releases/tag/v0.1.0
