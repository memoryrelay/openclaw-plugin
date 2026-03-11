# Changelog

All notable changes to the OpenClaw plugin for MemoryRelay will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- OpenClaw SDK alignment: now uses 12 lifecycle hooks (up from 2), 5 direct commands, 1 background service

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

[Unreleased]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.13.0...HEAD
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
