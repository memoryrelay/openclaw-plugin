# MemoryRelay AI - OpenClaw Memory Plugin

[![npm version](https://img.shields.io/npm/v/@memoryrelay/plugin-memoryrelay-ai.svg)](https://www.npmjs.com/package/@memoryrelay/plugin-memoryrelay-ai)
[![OpenClaw Compatible](https://img.shields.io/badge/OpenClaw-2026.2.26+-blue.svg)](https://openclaw.ai)

AI-powered long-term memory for OpenClaw agents. Gives your AI assistant persistent memory, project context, architectural decision records, reusable patterns, and session tracking across conversations.

## Features

- **39 Tools** covering memories, entities, sessions, decisions, patterns, and projects
- **6 Gateway Methods** for stats, debugging, and onboarding
- **Smart Auto-Capture** - Tier-based privacy system with automatic filtering
- **Daily Memory Stats** - Morning/evening summaries with growth metrics
- **Debug & Monitoring** - Comprehensive logging, health checks, and performance metrics
- **Semantic Search** - Vector-based retrieval finds relevant context by meaning
- **Auto-Recall** - Automatically injects relevant memories into agent context
- **Project-First Workflow** - Agents receive workflow instructions to start with project context
- **Decision Records** - Track and check architectural decisions before making new ones
- **Pattern Library** - Create, search, and adopt reusable conventions across projects
- **Session Tracking** - Track work sessions with summaries for continuity
- **External Session IDs** - Multi-agent collaboration and conversation-spanning sessions
- **Tool Group Filtering** - Enable only the tool groups you need

## Installation

### Requirements

- OpenClaw >= 2026.2.26
- Node.js >= 20.0.0
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
| `autoCapture` | boolean\|object | `false` | Auto-capture config. Boolean for backward compat, object for tier system: `{enabled, tier, confirmFirst}`. Tiers: `off`, `conservative`, `smart`, `aggressive`. |
| `recallLimit` | number | `5` | Max memories to inject per turn (1-20) |
| `recallThreshold` | number | `0.3` | Minimum similarity score for recall (0-1) |
| `excludeChannels` | string[] | `[]` | Channel IDs to skip auto-recall |
| `debug` | boolean | `false` | Enable debug logging of API calls |
| `verbose` | boolean | `false` | Include request/response bodies in debug logs |
| `logFile` | string | — | Optional file path for persistent debug logs |
| `maxLogEntries` | number | `100` | Circular buffer size for in-memory logs |

## Smart Auto-Capture

Four capture modes with built-in privacy protection:

| Tier | When to Use | Privacy Level |
|------|-------------|---------------|
| `off` | Manual storage only | N/A |
| `conservative` | Low-risk conversations only | High (blocks most patterns) |
| `smart` | Balanced automation | Medium (blocks sensitive data) |
| `aggressive` | Maximum capture | Low (minimal blocking) |

**Privacy Blocklist** — Automatically filters passwords, API keys, credit card numbers, SSNs, and other sensitive data.

```json
{
  "autoCapture": {
    "enabled": true,
    "tier": "smart",
    "confirmFirst": 5
  }
}
```

With `confirmFirst`, the first N captures show confirmation prompts before running silently.

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

## Debug & Monitoring

### Enable Debug Mode

```json
{
  "debug": true,
  "verbose": false,
  "maxLogEntries": 1000
}
```

### Gateway Methods

| Method | Purpose | Example |
|--------|---------|---------|
| `memoryrelay.logs` | View debug logs | `openclaw gateway-call memoryrelay.logs '{"limit": 50}'` |
| `memoryrelay.health` | Run health check | `openclaw gateway-call memoryrelay.health` |
| `memoryrelay.test` | Test individual tools | `openclaw gateway-call memoryrelay.test '{"tool": "memory_store"}'` |
| `memoryrelay.metrics` | View performance stats | `openclaw gateway-call memoryrelay.metrics` |
| `memoryrelay.heartbeat` | Daily stats check | `openclaw gateway-call memoryrelay.heartbeat` |
| `memoryrelay.stats` | CLI stats command | `openclaw gateway-call memoryrelay.stats '{"format": "json"}'` |
| `memoryrelay.onboarding` | Show onboarding | `openclaw gateway-call memoryrelay.onboarding` |
| `memory.status` | Plugin status report | `openclaw gateway-call memory.status` |

### Debug Log Format

When debug mode is enabled, each API call is logged with timestamp, tool name, duration, and status. Verbose mode additionally captures request/response bodies for deep troubleshooting.

## Privacy & Security

- **Cloud-Backed** — Memories stored on MemoryRelay servers (HTTPS-encrypted in transit)
- **API Key Auth** — Bearer token authentication
- **Agent Isolation** — Memories scoped per agent ID
- **Channel Filtering** — Exclude sensitive channels from auto-recall
- **Privacy Blocklist** — Auto-capture filters sensitive data (passwords, SSNs, credit cards, API keys)
- **Never store secrets** — Do not store API keys, passwords, or tokens as memories

## Troubleshooting

### Plugin Not Loading

```bash
# Check if installed
npm list -g @memoryrelay/plugin-memoryrelay-ai

# Reinstall if needed
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai --force

# Restart gateway
openclaw gateway restart

# Check logs for errors
openclaw gateway logs | grep memoryrelay
```

### API Connection Issues

```bash
# Test API directly
curl -H "X-API-Key: YOUR_KEY" https://api.memoryrelay.net/v1/health

# Check gateway logs
openclaw gateway logs -f | grep memory-memoryrelay
```

### Auto-Recall Not Working

1. Verify `autoRecall: true` in config
2. Check memories exist: `openclaw gateway call memory_list '{"limit": 10}'`
3. Lower `recallThreshold` (try 0.1) for more results
4. Check channel not in `excludeChannels`

### Known Limitations

- `memory_batch_store`: May return 500 errors (use individual `memory_store` as workaround)
- `memory_context`: Returns 405 Method Not Allowed (use `memory_recall` instead)

## Development

```bash
git clone https://github.com/memoryrelay/openclaw-plugin.git
cd openclaw-plugin
npm install
npm test
npm run test:watch
npm run test:coverage
```

## License

MIT License - see [LICENSE](./LICENSE) file

## Links

- **MemoryRelay**: https://memoryrelay.ai
- **OpenClaw**: https://docs.openclaw.ai
- **Repository**: https://github.com/memoryrelay/openclaw-plugin
- **Issues**: https://github.com/memoryrelay/openclaw-plugin/issues
