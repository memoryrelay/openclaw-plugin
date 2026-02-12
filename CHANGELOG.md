# Changelog

All notable changes to the OpenClaw plugin for MemoryRelay will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/memoryrelay/openclaw-plugin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/memoryrelay/openclaw-plugin/releases/tag/v0.1.0
