---
verified_at: 2026-10-15
verified_commit: 889029f7ac3e335f3a462cf9671ed9efeb4ecd79
---

# Gotchas — traps that already cost a release, each with its source

## The OpenClaw host (each new OpenClaw release can move these)

- **`register` must return synchronously**: 2026.9 refuses a plugin whose register returns a promise (0.25.1, `CHANGELOG.md:79`); startup network calls run in the background (`index.ts:396`, `index.ts:620`).
- **A tool must be named in the manifest** `contracts.tools` or `registerTool` is rejected and the tool is silently absent (0.25.2, `CHANGELOG.md:74`; guarded by `tests/manifest-contracts.test.ts`).
- **`before_agent_start` no longer exists** on 2026.9; pinned context runs on `before_prompt_build` (0.25.3, `CHANGELOG.md:66`; `src/hooks/before-agent-start.ts:117`). Conversation hooks only run for a non-bundled plugin when `hooks.allowConversationAccess` is set for it (`README.md:408`, "Lifecycle Hooks").
- **The manifest has no `kind`**: a single-kind `memory` plugin is disabled when another plugin holds the memory slot, and this plugin never registered a memory capability. memory-core keeps the slot; this plugin supplements it (0.26.0, `CHANGELOG.md:52`). `memory_get` is memory-core's: OpenClaw keeps the first registration of a tool name.
- **One corpus supplement per plugin**: a later registration replaces the earlier, so every source goes through `combineCorpusSupplements`; never call `registerMemoryCorpusSupplement` twice (`src/memory/corpus-supplement.ts:158-165`, `index.ts:556-568`).
- **Dreaming promotes nothing by default with this plugin**: promotion needs `minUniqueQueries` (3) user queries from memory-core's own `memory_search`, which auto-recall makes agents skip; the fix is host config, `plugins.entries.memory-core.config.dreaming.phases.deep.minUniqueQueries: 0`, and it is why the write-back mirrors all of MEMORY.md (`CHANGELOG.md:27`).
- **A `.ts` entry point crash-loops the gateway** on OpenClaw 2026.7.1 and later (issue #138): see [build-and-test.md](build-and-test.md).

## The plugin

- **The plugin id is `plugin-memoryrelay-ai`** (`openclaw.plugin.json:2`), not `memory-memoryrelay` (that string is only the log prefix); a wrong id gives "No install record".
- **`memory_batch_store` may return 500 on large batches**; store one at a time as the workaround (README, "Known Limitations", `README.md:497`).
- **`logFile` is deprecated and ignored** since 0.8.4 (`src/debug-logger.ts:29`, `src/debug-logger.ts:39`), though `index.ts` still passes it through.
- **Onboarding state is global**, not per project: `~/.openclaw/memoryrelay-onboarding.json` (`src/onboarding/first-run.ts:31`).
- **`src/hooks/before-agent-start.ts` is named after a hook it no longer uses** (it listens on `before_prompt_build`), and the JSDoc header of `index.ts` (`index.ts:1-15`) still lists sessions, decisions, patterns and projects (its version line is held to `package.json` by `tests/version-consistency.test.ts`). Trust the code and `TOOL_GROUPS`, not that header.
