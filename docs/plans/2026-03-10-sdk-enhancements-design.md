# SDK Enhancements Design — OpenClaw v2026.3.2 Alignment

## Purpose

Align the MemoryRelay plugin with the full OpenClaw SDK v2026.3.2 API surface before release. Add direct commands, background service, hook events, and sender identity tagging.

## Scope

### In Scope

| Feature | What |
|---------|------|
| 5 direct commands | `/memory-status`, `/memory-stats`, `/memory-health`, `/memory-logs`, `/memory-metrics` |
| 1 background service | Stale session auto-closer (configurable timeout) |
| 10 hook events (7 groups) | Tool observation, session sync, compaction rescue, message processing, subagent lifecycle, tool result redaction, session reset |
| Sender identity tagging | Auto-tag memories with `sender_id` from tool context |

### Out of Scope

- HTTP routes (gateway methods already cover admin access)
- Channel/provider/media registration (not relevant for memory plugin)
- Config validation upgrade (JSON schema is sufficient)
- LLM observation hooks (nice-to-have, not core)
- Gateway lifecycle hooks (just logging)
- Model override hook (not relevant)

## Direct Commands

5 commands, each a thin wrapper around existing gateway method logic:

| Command | Handler | Returns |
|---------|---------|---------|
| `/memory-status` | `StatusReporter.buildReport()` | Connection status, tool counts, memory stats |
| `/memory-stats` | `gatherStatsForCLI()` + `formatStatsAsText()` | Memory growth, categories, daily stats |
| `/memory-health` | `client.health()` + tool tests | API health, response time |
| `/memory-logs` | `debugLogger.getRecentLogs()` | Last 10 debug log entries |
| `/memory-metrics` | `toolMetrics` map | Per-tool call count, success rate, p95/p99 |

All commands: `requireAuth: true`, `acceptsArgs: false`, return formatted text via `ReplyPayload`.

## Background Service — Stale Session Closer

- Service ID: `memoryrelay-session-cleanup`
- Configurable interval (default: 30 minutes)
- Checks in-memory session cache for sessions older than configurable timeout (default: 2 hours)
- Calls `session_end` with auto-generated summary: `"Auto-closed: inactive for >2h"`
- Logs closures via `api.logger.info`

New config options:

| Config Key | Type | Default | Description |
|-----------|------|---------|-------------|
| `sessionTimeoutMinutes` | number | 120 | Auto-close sessions inactive for this long |
| `sessionCleanupIntervalMinutes` | number | 30 | How often to check for stale sessions |

State tracking: Add `lastActivityAt` timestamp per session entry in the session cache, updated on every tool call that references the session.

## Hook Implementations

### A. Tool Observation (`before_tool_call`, `after_tool_call`)

- `before_tool_call`: No-op, registered for future extensibility.
- `after_tool_call`: Updates `lastActivityAt` on active session. Updates `toolMetrics`.

### B. Session Sync (`session_start`, `session_end`)

- `session_start`: Auto-creates MemoryRelay session linked to OpenClaw session via `getOrCreateSession()` with OpenClaw `sessionId` as external ID.
- `session_end`: Auto-ends corresponding MemoryRelay session if one exists. Removes from session cache.

### C. Compaction Rescue (`before_compaction`)

- Extracts key facts from messages about to be compacted.
- Stores as memories with `category: "compaction-rescue"`, `tier: "warm"`.
- Heuristic: only assistant messages longer than 200 chars.
- Respects privacy blocklist.

### D. Message Processing (`message_received`, `message_sending`, `before_message_write`)

- `message_received`: Tags active session with sender channel info.
- `message_sending`: No-op, registered for extensibility.
- `before_message_write`: Runs privacy blocklist regex against message content. Redacts matches with `[REDACTED]`.

### E. Subagent Lifecycle (`subagent_spawned`, `subagent_ended`)

- `subagent_spawned`: Logs child session key, links to parent MemoryRelay session via metadata.
- `subagent_ended`: Stores memory summarizing subagent outcome, linked to parent session.

### F. Tool Result Redaction (`tool_result_persist`)

- Applies privacy blocklist to tool results before persistence.
- Redacts sensitive patterns with `[REDACTED]`.

### G. Session Reset (`before_reset`)

- Same logic as compaction rescue — saves key facts before messages are cleared.
- Uses `category: "session-reset-rescue"`.

## Sender Identity Tagging

In tool factories for `memory_store`, `memory_batch_store`, and `decision_record`:
- Extract `ctx.requesterSenderId` from tool context
- Auto-inject as `sender_id` in metadata
- Only adds if `requesterSenderId` is present
- Doesn't overwrite if caller explicitly passes `sender_id`
- Applied to store operations only

## Testing Strategy

| Feature | Test Approach |
|---------|--------------|
| Commands | Mock existing gateway handler logic, verify formatted text output |
| Stale session service | Mock `client.endSession()`, fake timers for timeout simulation |
| Hook events | Mock event payloads per hook type, verify side effects |
| Sender tagging | Pass tool context with `requesterSenderId`, verify metadata injection |
| Privacy redaction | Test blocklist patterns in `before_message_write` and `tool_result_persist` |

All tests use existing `MockMemoryRelayClient` pattern and Vitest.
