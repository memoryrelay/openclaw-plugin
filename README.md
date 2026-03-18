# MemoryRelay AI

**Engineering Knowledge Platform for OpenClaw**

Persistent memory, architectural decisions, reusable patterns, and project orchestration for AI agents.

[![npm version](https://img.shields.io/npm/v/@memoryrelay/plugin-memoryrelay-ai.svg)](https://www.npmjs.com/package/@memoryrelay/plugin-memoryrelay-ai)
[![OpenClaw Compatible](https://img.shields.io/badge/OpenClaw-2026.2.26+-blue.svg)](https://openclaw.ai)

## Why MemoryRelay?

MemoryRelay is designed for engineering teams managing complex, long-running projects. It is not general-purpose Q&A memory.

| Feature | MemoryRelay | Mem0 | OpenClaw-Projects |
|---------|------------|------|-------------------|
| Semantic search | Yes (pgvector) | Yes | No |
| Sessions | Yes (auto-sync with OpenClaw sessions) | No | No |
| Architectural Decision Records | Yes (record, check, supersede) | No | No |
| Reusable patterns | Yes (create, adopt, suggest) | No | No |
| Project orchestration | Yes (10 tools, dependency graphs) | No | Basic |
| Entities / knowledge graph | Yes (create, link, graph) | Yes | No |
| Multi-agent collaboration | Yes (agent scoping, subagent tracking) | Limited | No |
| Auto-capture with privacy tiers | Yes (off/conservative/smart/aggressive) | Basic | No |
| V2 Async Storage | Yes | No | No |
| Direct commands | 17 | ~5 | 0 |
| Lifecycle hooks | 13 | 0 | 0 |
| Tools | 42 | ~10 | 0 |

## Quick Start

**1. Install the plugin**

```bash
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
```

**2. Set your API key**

```bash
export MEMORYRELAY_API_KEY="mem_prod_your_key_here"
```

Or configure inline:

```bash
openclaw config set plugins.entries.plugin-memoryrelay-ai.config '{"apiKey": "mem_prod_..."}'
```

**3. Verify**

```
/memory-health
```

Auto-recall and smart auto-capture are enabled by default. The plugin injects relevant memories into context every turn and captures important information automatically.

## Use Cases

**Tech Lead** managing 3+ projects:
- Record architectural decisions with `decision_record` so future agents (and teammates) check before re-deciding
- Create reusable patterns (`pattern_create`) and adopt them across projects
- Use `project_impact` to understand blast radius before cross-cutting changes

**DevOps Engineer**:
- Store infrastructure decisions as ADRs: "Why we chose Fargate over ECS on EC2"
- Capture runbooks and operational procedures as patterns
- Track dependencies between services with `project_add_relationship`

**Solo Developer**:
- Build a personal knowledge base of memories, entities, and decisions
- Use `memory_recall` for semantic search across everything you have stored
- Link entities to memories for a navigable knowledge graph

**Coding Agent**:
- Auto-capture learns from conversations without explicit tool calls
- Pattern adoption ensures consistent code style across sessions
- Session tracking provides continuity when context windows reset

## Features -- 42 Tools by Category

### Memory (9 tools) -- group: `memory`

| Tool | Description |
|------|-------------|
| `memory_store` | Store a memory with optional project scoping, deduplication, importance, and tier |
| `memory_recall` | Semantic search across memories with project/tier/importance filters |
| `memory_forget` | Delete a memory by ID or search query |
| `memory_list` | List recent memories with pagination |
| `memory_get` | Retrieve a specific memory by ID |
| `memory_update` | Update content of an existing memory |
| `memory_batch_store` | Store multiple memories in one call |
| `memory_context` | Build a token-budget-aware context window from relevant memories |
| `memory_promote` | Update a memory's importance score and tier |

### Entity (4 tools) -- group: `entity`

| Tool | Description |
|------|-------------|
| `entity_create` | Create a knowledge graph node (person, place, org, project, concept) |
| `entity_link` | Link an entity to a memory with a relationship label |
| `entity_list` | List entities with pagination |
| `entity_graph` | Explore an entity's neighborhood in the knowledge graph |

### Agent (3 tools) -- group: `agent`

| Tool | Description |
|------|-------------|
| `agent_list` | List available agents |
| `agent_create` | Create a new agent (memory namespace) |
| `agent_get` | Get agent details by ID |

### Session (4 tools) -- group: `session`

| Tool | Description |
|------|-------------|
| `session_start` | Start a work session with title and project |
| `session_end` | End a session with a summary |
| `session_recall` | Get session details and timeline |
| `session_list` | List sessions filtered by project or status |

### Decision (4 tools) -- group: `decision`

| Tool | Description |
|------|-------------|
| `decision_record` | Record an architectural decision with rationale and alternatives |
| `decision_list` | List decisions filtered by project, status, or tags |
| `decision_supersede` | Replace a decision with a new one (old is marked superseded) |
| `decision_check` | Semantic search for existing decisions before making new ones |

### Pattern (4 tools) -- group: `pattern`

| Tool | Description |
|------|-------------|
| `pattern_create` | Create a reusable convention with example code |
| `pattern_search` | Semantic search for established patterns |
| `pattern_adopt` | Adopt an existing pattern for a project |
| `pattern_suggest` | Get pattern suggestions based on project stack |

### Project (10 tools) -- group: `project`

| Tool | Description |
|------|-------------|
| `project_register` | Register a project with slug, name, stack, and repo URL |
| `project_list` | List all registered projects |
| `project_info` | Get project details |
| `project_add_relationship` | Add relationship between projects (depends_on, extends, etc.) |
| `project_dependencies` | List projects that a project depends on |
| `project_dependents` | List projects that depend on a project |
| `project_related` | List all related projects (any direction) |
| `project_impact` | Analyze blast radius of a proposed change |
| `project_shared_patterns` | Find patterns shared between two projects |
| `project_context` | Load full project context (memories, decisions, patterns, sessions) |

### V2 Async (3 tools) -- group: `v2`

| Tool | Description |
|------|-------------|
| `memory_store_async` | Store a memory asynchronously and return a job ID |
| `memory_status` | Check the processing status of an async memory job |
| `context_build` | Build a ranked context bundle from relevant memories |

### Health (1 tool) -- group: `health`

| Tool | Description |
|------|-------------|
| `memory_health` | Check API connectivity and health status |

## Direct Commands

These slash commands bypass the LLM and execute immediately.

### Inspection Commands

| Command | Description |
|---------|-------------|
| `/memory-search <query>` | Semantic search across stored memories |
| `/memory-context` | Build ranked context bundle from memories |
| `/memory-sessions` | List sessions (optional: `active`, `closed`, or project slug) |
| `/memory-decisions` | List architectural decisions (optional: project slug) |
| `/memory-patterns` | List or search patterns (optional: search query) |
| `/memory-entities` | List entities (optional: entity type filter) |
| `/memory-projects` | List registered projects |
| `/memory-agents` | List registered agents |

### Diagnostic Commands

| Command | Description |
|---------|-------------|
| `/memory-status` | Connection status, tool counts, and memory stats |
| `/memory-stats` | Daily statistics (total, growth, top categories) |
| `/memory-health` | API health check with response time |
| `/memory-logs` | Recent debug log entries (optional: limit, tool filter) |
| `/memory-metrics` | Per-tool call counts, success rates, and latency |
| `/memory-validate` | Production readiness checks |
| `/memory-config` | Display current plugin configuration |

### Management Commands

| Command | Description |
|---------|-------------|
| `/memory-forget <id>` | Delete a specific memory by ID |

## Configuration Reference

```bash
openclaw config set plugins.entries.plugin-memoryrelay-ai.config '{
  "apiKey": "mem_prod_...",
  "agentId": "iris",
  "defaultProject": "my-api",
  "autoRecall": true,
  "autoCapture": { "enabled": true, "tier": "smart", "confirmFirst": 5 }
}'
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `apiKey` | string | -- | MemoryRelay API key |
| `agentId` | string | -- | Unique agent identifier |
| `apiUrl` | string | `https://api.memoryrelay.net` | API endpoint |
| `defaultProject` | string | -- | Default project slug for sessions, decisions, and memories |
| `enabledTools` | string | `all` | Comma-separated tool groups to enable |
| `autoRecall` | boolean | `true` | Inject relevant memories into context each turn |
| `autoCapture` | boolean \| object | `true` | Auto-capture config (see tiers below) |
| `recallLimit` | number | `5` | Max memories injected per turn (1-20) |
| `recallThreshold` | number | `0.3` | Minimum similarity score for recall (0-1) |
| `excludeChannels` | string[] | `[]` | Channel IDs to skip auto-recall |
| `sessionTimeoutMinutes` | number | `120` | Idle time before session auto-close (10-1440) |
| `sessionCleanupIntervalMinutes` | number | `30` | Stale session check interval (5-360) |
| `debug` | boolean | `false` | Enable debug logging of API calls |
| `verbose` | boolean | `false` | Include request/response bodies in logs |
| `maxLogEntries` | number | `100` | Circular buffer size for in-memory logs (10-10000) |

### Environment Variables

| Variable | Maps to |
|----------|---------|
| `MEMORYRELAY_API_KEY` | `apiKey` |
| `MEMORYRELAY_AGENT_ID` | `agentId` |
| `MEMORYRELAY_API_URL` | `apiUrl` |
| `MEMORYRELAY_DEFAULT_PROJECT` | `defaultProject` |

### Auto-Capture Tiers

| Tier | Behavior | Use When |
|------|----------|----------|
| `off` | Manual `memory_store` only | Full control, no surprises |
| `conservative` | Captures only low-risk technical facts | Sensitive environments |
| `smart` (default) | Balanced automation with privacy blocklist | Most teams |
| `aggressive` | Maximum capture, minimal filtering | Solo prototyping |

The `confirmFirst` setting (default: `5`) prompts for confirmation on the first N captures before running silently. The `blocklist` array accepts regex patterns for content that should never be captured.

```json
{
  "autoCapture": {
    "enabled": true,
    "tier": "smart",
    "confirmFirst": 5,
    "blocklist": ["password", "secret", "Bearer\\s+\\S+"],
    "categories": {
      "credentials": true,
      "preferences": true,
      "technical": true,
      "personal": false
    }
  }
}
```

## Architecture & Privacy

### Data Flow

```
Agent <-> Plugin <-> MemoryRelay API (HTTPS) <-> PostgreSQL + pgvector
```

All data in transit is encrypted via HTTPS. The plugin communicates with `api.memoryrelay.net` using bearer token authentication.

### Privacy Controls

- **Blocklist regex patterns** in auto-capture config filter passwords, API keys, credit card numbers, SSNs, and other sensitive data before storage
- **Redaction hooks** on `before_message_write` and `tool_result_persist` apply blocklist patterns to messages and tool results before persistence
- **No credential storage** by default -- the `personal` category requires explicit opt-in
- **Channel exclusions** prevent auto-recall on sensitive channels

### Multi-Agent Support

- Each agent has its own memory namespace via `agentId`
- Projects, decisions, and patterns are shared across agents
- Subagent spawning and completion are tracked via lifecycle hooks (`subagent_spawned`, `subagent_ended`)
- Sender identity is auto-injected into memory metadata for traceability

### Lifecycle Hooks

The plugin registers 14 lifecycle hooks:

| Hook | Purpose |
|------|---------|
| `before_agent_start` | Auto-recall and workflow injection |
| `agent_end` | Auto-capture from completed conversations |
| `session_start` | Auto-create MemoryRelay session from OpenClaw session |
| `session_end` | Auto-end MemoryRelay session |
| `before_tool_call` | Reserved for future tool blocking/audit |
| `after_tool_call` | Session activity tracking and metrics |
| `before_compaction` | Save key context before compaction |
| `before_reset` | Save key context before session reset |
| `message_received` | Activity timestamp updates |
| `message_sending` | Reserved for future extensibility |
| `before_message_write` | Privacy redaction |
| `subagent_spawned` | Track multi-agent collaboration |
| `subagent_ended` | Store subagent completion summaries |
| `tool_result_persist` | Privacy redaction on tool results |

### Skills

The plugin ships with 5 skills providing guided workflows on top of the raw tools:

- `memory-workflow` — Session lifecycle, storing/retrieving memories
- `decision-tracking` — ADR management, checking before deciding
- `pattern-management` — Reusable conventions, search before create
- `project-orchestration` — Multi-project context loading and impact analysis
- `entity-and-context` — Knowledge graph, linking entities to memories

## Updating

To update to the latest version:

```bash
openclaw plugins update plugin-memoryrelay-ai
```

Or from within a conversation, run `/memory-update` to see the exact command.

**Important:** The plugin ID is `plugin-memoryrelay-ai` (not `memory-memoryrelay`). Using the wrong ID will fail with "No install record."

After updating, restart the gateway:

```bash
openclaw restart
```

## Troubleshooting

### Connection refused / API key issues

```bash
# Test the API directly
curl -H "X-API-Key: $MEMORYRELAY_API_KEY" https://api.memoryrelay.net/v1/health

# Check plugin status
/memory-health

# Run full validation
/memory-validate
```

If `/memory-health` shows `connected: false`, verify your API key is set correctly via environment variable or config. Keys start with `mem_prod_`.

### Auto-recall not working

1. Confirm `autoRecall` is `true` (it is by default)
2. Verify memories exist: run `/memory-search test` to check
3. Lower `recallThreshold` to `0.1` for broader matching
4. Check your channel is not in `excludeChannels`
5. Run `/memory-status` to see the full plugin state

### Debug logging

Enable debug mode to see all API calls:

```json
{
  "debug": true,
  "verbose": true,
  "maxLogEntries": 1000
}
```

Then inspect with `/memory-logs` or `/memory-metrics` to identify slow or failing calls.

### Known Limitations

- `memory_batch_store`: May return 500 errors on large batches (use individual `memory_store` as workaround)
- `memory_context`: Returns 405 Method Not Allowed on some API versions (use `memory_recall` instead)

## Development

```bash
git clone https://github.com/memoryrelay/openclaw-plugin.git
cd openclaw-plugin
npm install
npm test
```

## Links

- **MemoryRelay**: https://memoryrelay.ai
- **OpenClaw**: https://docs.openclaw.ai
- **Repository**: https://github.com/memoryrelay/openclaw-plugin

## License

MIT
