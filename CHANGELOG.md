# Changelog

All notable changes to the OpenClaw plugin for MemoryRelay will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] - 2026-02-13

### Fixed
- Added `safety` declaration to plugin manifest to resolve false-positive security warning
- Whitelisted environment variables: `MEMORYRELAY_API_KEY`, `MEMORYRELAY_AGENT_ID`, `MEMORYRELAY_BASE_URL`
- Whitelisted network access: `api.memoryrelay.net`
- Plugin installation no longer shows "dangerous code patterns" warning

### Impact
- Clarifies that environment variable access is legitimate configuration fallback
- Removes confusing security warning during installation
- Plugin is now explicitly approved for env var usage

## [0.4.0] - 2026-02-13

### Added
- Status reporting via `memory.status` gateway RPC method
- Plugin now reports availability and connection status to `openclaw status`
- Memory count reporting (via new `/v1/stats` API endpoint)
- Vector availability reporting for semantic search
- Graceful handling of missing stats endpoint (backwards compatible)
- Status shows "available" when API is reachable, "unavailable" when down
- Detailed status information: connected state, endpoint, agent ID, memory count

### Fixed
- Plugin no longer shows as "unavailable" in `openclaw status` when functional
- Status accurately reflects API connection state

### Technical Improvements
- Extracted `DEFAULT_API_URL` and `VALID_HEALTH_STATUSES` constants for maintainability
- Case-insensitive health status validation using extensible array pattern
- Proper type safety with nullish coalescing operators throughout
- Consistent variable usage with extracted `apiUrl` for clarity

## [0.3.0] - 2026-02-13

### Changed
- Better installation UX with env var support

## [0.1.0] - 2026-02-12

### Added
- Initial release
- Three AI agent tools: `memory_store`, `memory_recall`, `memory_forget`
- Auto-recall lifecycle hook (inject relevant memories into context)
- Auto-capture lifecycle hook (detect and store important information)
- CLI commands: `openclaw memoryrelay status|list|search`
- Support for semantic search with configurable threshold
- Multi-agent support with isolated namespaces
- Environment variable configuration support
- Comprehensive documentation

### Security
- API key handling via config or environment variables
- Auto-capture disabled by default (privacy)
- Pattern-based filtering for sensitive data

[Unreleased]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/memoryrelay/openclaw-plugin/releases/tag/v0.1.0
