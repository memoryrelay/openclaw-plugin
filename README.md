# MemoryRelay AI - OpenClaw Memory Plugin

[![npm version](https://img.shields.io/npm/v/@memoryrelay/plugin-memoryrelay-ai.svg)](https://www.npmjs.com/package/@memoryrelay/plugin-memoryrelay-ai)
[![OpenClaw Compatible](https://img.shields.io/badge/OpenClaw-2026.2.26+-blue.svg)](https://openclaw.ai)

AI-powered long-term memory for OpenClaw agents. Gives your AI assistant persistent memory, project context, architectural decision records, reusable patterns, and session tracking across conversations.

## Features

- **39 Tools** covering memories, entities, sessions, decisions, patterns, and projects
- **Semantic Search** - Vector-based retrieval finds relevant context by meaning
- **Auto-Recall** - Automatically injects relevant memories into agent context
- **Project-First Workflow** - Agents receive workflow instructions to start with project context
- **Decision Records** - Track and check architectural decisions before making new ones
- **Pattern Library** - Create, search, and adopt reusable conventions across projects
- **Session Tracking** - Track work sessions with summaries for continuity
- **Tool Group Filtering** - Enable only the tool groups you need

## Installation

### Requirements

- OpenClaw >= 2026.2.26
- Node.js >= 18.0.0
- MemoryRelay API key ([get one at memoryrelay.ai](https://memoryrelay.ai))

### Install via OpenClaw CLI

```bash
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
```

### Configuration

```bash
openclaw config set plugins.entries.plugin-memoryrelay-ai.config '{
  "apiKey": "mem_prod_your_key_here",
  "agentId": "your-agent-name",
  "defaultProject": "my-project",
  "autoRecall": true,
  "autoCapture": false
}'

# Or use environment variables
export MEMORYRELAY_API_KEY="mem_prod_your_key_here"
export MEMORYRELAY_AGENT_ID="your-agent-name"
export MEMORYRELAY_DEFAULT_PROJECT="my-project"

# Restart gateway
openclaw gateway restart
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | — | MemoryRelay API key (or `MEMORYRELAY_API_KEY` env var) |
| `agentId` | string | — | Unique agent identifier (or `MEMORYRELAY_AGENT_ID` env var, or agent name) |
| `apiUrl` | string | `https://api.memoryrelay.net` | API endpoint (or `MEMORYRELAY_API_URL` env var) |
| `defaultProject` | string | — | Default project slug applied to sessions, decisions, and memories |
| `enabledTools` | string | `all` | Comma-separated tool groups: `memory`, `entity`, `agent`, `session`, `decision`, `pattern`, `project`, `health` |
| `autoRecall` | boolean | `true` | Inject relevant memories into context each turn |
| `autoCapture` | boolean | `false` | Auto-capture important information from conversations |
| `recallLimit` | number | `5` | Max memories to inject per turn (1-20) |
| `recallThreshold` | number | `0.3` | Minimum similarity score for recall (0-1) |
| `excludeChannels` | string[] | `[]` | Channel IDs to skip auto-recall |

## Agent Workflow

The plugin injects workflow instructions into every agent conversation via the `before_agent_start` hook, guiding the AI to follow a project-first approach:

1. **Load context** — `project_context(project)` loads hot-tier memories, active decisions, and adopted patterns
2. **Start session** — `session_start(title, project)` begins tracking work
3. **Check decisions** — `decision_check(query, project)` before architectural choices
4. **Find patterns** — `pattern_search(query)` to find established conventions
5. **Store findings** — `memory_store(content)` for important information
6. **Record decisions** — `decision_record(title, rationale)` for significant choices
7. **End session** — `session_end(session_id, summary)` with accomplishment summary

For new projects, the agent is guided to call `project_register()` first.

## Tool Reference

### Memory Tools (9 tools) — group: `memory`

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

### Entity Tools (4 tools) — group: `entity`

| Tool | Description |
|------|-------------|
| `entity_create` | Create a knowledge graph node (person, place, org, project, concept) |
| `entity_link` | Link an entity to a memory with a relationship label |
| `entity_list` | List entities with pagination |
| `entity_graph` | Explore an entity's neighborhood in the knowledge graph |

### Agent Tools (3 tools) — group: `agent`

| Tool | Description |
|------|-------------|
| `agent_list` | List available agents |
| `agent_create` | Create a new agent (memory namespace) |
| `agent_get` | Get agent details by ID |

### Session Tools (4 tools) — group: `session`

| Tool | Description |
|------|-------------|
| `session_start` | Start a work session with title and project |
| `session_end` | End a session with a summary |
| `session_recall` | Get session details and timeline |
| `session_list` | List sessions filtered by project or status |

### Decision Tools (4 tools) — group: `decision`

| Tool | Description |
|------|-------------|
| `decision_record` | Record an architectural decision with rationale and alternatives |
| `decision_list` | List decisions filtered by project, status, or tags |
| `decision_supersede` | Replace a decision with a new one (old is marked superseded) |
| `decision_check` | Semantic search for existing decisions before making new ones |

### Pattern Tools (4 tools) — group: `pattern`

| Tool | Description |
|------|-------------|
| `pattern_create` | Create a reusable convention with example code |
| `pattern_search` | Semantic search for established patterns |
| `pattern_adopt` | Adopt an existing pattern for a project |
| `pattern_suggest` | Get pattern suggestions based on project stack |

### Project Tools (10 tools) — group: `project`

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

### Health Tools (1 tool) — group: `health`

| Tool | Description |
|------|-------------|
| `memory_health` | Check API connectivity and health status |

## Tool Group Filtering

Only enable the groups you need:

```json
{
  "enabledTools": "memory,session,decision"
}
```

This enables only the memory (9), session (4), and decision (4) tools — 17 tools instead of 39. Useful for reducing tool clutter when you don't need project graphs or pattern management.

Available groups: `memory`, `entity`, `agent`, `session`, `decision`, `pattern`, `project`, `health`

Set to `all` (or omit) to enable everything.

## Auto-Recall

When `autoRecall: true`, relevant memories are automatically injected into agent context each turn:

```
User: "How should I handle authentication in this project?"

[Plugin searches memories for "authentication"]
[Injects workflow instructions + top 5 relevant memories into context]
Agent uses past decisions and patterns to inform its response
```

## Channel Exclusions

Exclude specific channels from auto-recall and workflow injection:

```json
{
  "excludeChannels": [
    "telegram:group_123456",
    "discord:channel_789012"
  ]
}
```

## CLI Commands

```bash
openclaw memoryrelay status   # Check connection and stats
openclaw memoryrelay stats    # Show memory count
openclaw memoryrelay list     # List recent memories
openclaw memoryrelay search "query"  # Search memories
openclaw memoryrelay delete <id>     # Delete a memory
openclaw memoryrelay export          # Export all memories to JSON
```

## Privacy & Security

- **Cloud-Backed** — Memories stored on MemoryRelay servers (HTTPS-encrypted in transit)
- **API Key Auth** — Bearer token authentication
- **Agent Isolation** — Memories scoped per agent ID
- **Channel Filtering** — Exclude sensitive channels from auto-recall
- **No Auto-Capture by Default** — Manual storage gives you full control
- **Never store secrets** — Do not store API keys, passwords, or tokens as memories. Use encrypted local files or secret managers instead.

## Troubleshooting

### Plugin Not Loading

```bash
openclaw plugins list | grep memoryrelay
openclaw config get plugins.entries.plugin-memoryrelay-ai
openclaw logs --tail 100 | grep memory
```

### API Connection Issues

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.memoryrelay.net/v1/health
```

## Changelog

### v0.7.0 (2026-03-05)

- **NEW**: 39 tools (up from 3) covering full MemoryRelay API surface
- **NEW**: Session tracking — `session_start`, `session_end`, `session_recall`, `session_list`
- **NEW**: Decision records — `decision_record`, `decision_list`, `decision_supersede`, `decision_check`
- **NEW**: Pattern library — `pattern_create`, `pattern_search`, `pattern_adopt`, `pattern_suggest`
- **NEW**: Project management — `project_register`, `project_list`, `project_info`, relationships, impact analysis, shared patterns, full context loading
- **NEW**: Enhanced memory tools — project scoping, deduplication, importance scores, three-tier storage, batch store, context building, promotion
- **NEW**: Agent workflow instructions injected via `before_agent_start` hook
- **NEW**: Tool group filtering via `enabledTools` config
- **NEW**: `defaultProject` config for automatic project scoping
- **FIX**: Workflow instructions now injected regardless of autoRecall setting

### v0.6.2 (2026-03-01)

- **FIX**: OpenClaw 2026.2.26 compatibility — Changed `extensions` from `["./"]` to `["./index.ts"]`
- **DOCS**: Added comprehensive README and migration guide

### v0.6.0 (2026-02-18)

- **NEW**: Retry logic with exponential backoff (3 attempts)
- **NEW**: Request timeout (30 seconds)
- **NEW**: Environment variable fallback support
- **NEW**: Channel filtering (`excludeChannels` config)

## Development

```bash
git clone https://github.com/memoryrelay/openclaw-plugin.git
cd openclaw-plugin
npm install
npm test              # Run once (50 tests)
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

## License

MIT License - see [LICENSE](./LICENSE) file

## Links

- **MemoryRelay**: https://memoryrelay.ai
- **OpenClaw**: https://docs.openclaw.ai
- **Repository**: https://github.com/memoryrelay/openclaw-plugin
- **Issues**: https://github.com/memoryrelay/openclaw-plugin/issues
