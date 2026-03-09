---
name: testing-memoryrelay
description: "Use when writing, running, or debugging tests for the MemoryRelay plugin, adding test coverage for new tools or hooks, or investigating test failures."
---

# Testing MemoryRelay

Test runner: **Vitest**. All tests run without a live API.

## Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run all tests once (`vitest run`) |
| `npm run test:watch` | Watch mode (`vitest`) |
| `npm run test:coverage` | Coverage report (`vitest run --coverage`) |

## Test Files

| File | Scope |
|------|-------|
| `index.test.ts` | Integration tests: API client, tools, hooks, retry logic, pattern detection, channel filtering, tool groups, workflow instructions |
| `src/debug-logger.test.ts` | DebugLogger unit tests: circular buffer, filtering by tool/status, stats, formatting |
| `src/status-reporter.test.ts` | StatusReporter unit tests: failure tracking, report building, formatting |

## Mock Pattern

Tests use `MockMemoryRelayClient` -- an in-memory implementation that replaces the real API client:

```typescript
import { describe, test, expect, beforeEach, vi } from "vitest";

class MockMemoryRelayClient {
  private memories: Memory[] = [];
  private nextId = 1;
  async store(content, metadata?) { /* push to array, return Memory */ }
  async search(query, limit?, threshold?) { /* keyword .includes() match */ }
  async list(limit?, offset?) { /* .slice() */ }
  async get(id) { /* .find(), throws if missing */ }
  async delete(id) { /* .splice(), throws if missing */ }
  async health() { return { status: "healthy" }; }
  async stats() { return { total_memories: this.memories.length }; }
}
```

Instantiate fresh per test with `beforeEach(() => { client = new MockMemoryRelayClient("test_key", "test_agent"); })`.

## What to Test per Tool

| Area | Checks |
|------|--------|
| Input validation | Required params present, types correct |
| Success path | API response formatted correctly, data stored/returned |
| Error handling | Non-existent IDs throw, empty results return `[]` |
| Deduplication | `deduplicate=true` prevents near-duplicate storage |
| Session injection | `session_id` auto-applied from active session |
| Retry logic | Network errors and 5xx retried; 4xx not retried |
| Timeouts | 30s timeout via `AbortController` |

## Testing Hooks

**`before_agent_start`** -- workflow injection and auto-recall:

- Verify workflow instructions are built from enabled tool groups
- Mock `client.search()` to test auto-recall injects context
- Test channel exclusion skips auto-recall for blocklisted channels

**`agent_end`** -- auto-capture:

- Test pattern detection (`shouldCapture`) with regex matching
- Verify length bounds (20-2000 chars)
- Confirm privacy blocklist rejects passwords, SSNs, API keys
- Test tier logic: `off`, `conservative`, `smart`, `aggressive`

## Testing Gateway Methods

| Check | How |
|-------|-----|
| Response format | Assert returned object shape matches API contract |
| Error surfaces | `detail` field extracted (FastAPI format), falls back to `message` |
| HTTP method | GET with query params for search/check; POST with body for create/link |

## Unit Test Patterns

**DebugLogger**: Uses `vi.mock("fs")`. Test circular buffer (`maxEntries`), `getRecentLogs(n)`, `getToolLogs(name)`, `getErrorLogs()`, `getStats()`, `clear()`, `formatEntry()`.

**StatusReporter**: Instantiate with real `DebugLogger`. Test `recordFailure`/`recordSuccess` toggle, `buildReport` shape, `formatReport`/`formatCompact` output, disconnected status handling.
