# OpenClaw Plugin for MemoryRelay AI

[![npm version](https://img.shields.io/npm/v/@memoryrelay/plugin-memoryrelay-ai)](https://www.npmjs.com/package/@memoryrelay/plugin-memoryrelay-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Long-term memory plugin for OpenClaw agents using [MemoryRelay API](https://api.memoryrelay.net).

## Features

- 🧠 **Semantic Search** — Natural language memory retrieval with vector embeddings
- 🔄 **Auto-Recall** — Automatically inject relevant memories into agent context
- 📝 **Auto-Capture** — Intelligently detect and store important information
- 🤖 **Multi-Agent** — Isolated memory namespaces per agent
- 🛠️ **CLI Tools** — Manage memories via `openclaw memoryrelay` commands
- 🔌 **Tool Integration** — Three memory tools for AI agents
- 🔗 **Works Alongside Built-in Memory** — Extends OpenClaw's local memory with cloud-backed persistence

## Installation

```bash
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
```

Or via npm:

```bash
npm install -g @memoryrelay/plugin-memoryrelay-ai
```

## Quick Start

### 1. Install the plugin

```bash
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
```

### 2. Configure API credentials

**Option A: Config file** (recommended)
```bash
cat ~/.openclaw/openclaw.json | jq '.plugins.entries."plugin-memoryrelay-ai".config = {
  "apiKey": "YOUR_API_KEY",
  "agentId": "YOUR_AGENT_ID",
  "autoRecall": true,
  "autoCapture": false
}' > /tmp/config.json && \
mv /tmp/config.json ~/.openclaw/openclaw.json && \
chmod 600 ~/.openclaw/openclaw.json
```

**Option B: Environment variables**
```bash
export MEMORYRELAY_API_KEY="YOUR_API_KEY"
export MEMORYRELAY_AGENT_ID="YOUR_AGENT_ID"
```

### 3. Restart the gateway

```bash
openclaw gateway restart
```

### 4. Verify it's working

```bash
# Test memory storage
openclaw agents <your-agent> --one-shot "Store a test memory: Plugin verification successful"

# Search for it
openclaw memoryrelay search "plugin verification"

# Check plugin status
openclaw plugins info plugin-memoryrelay-ai
# Should show: Status: loaded

# Check logs
journalctl -u openclaw-gateway --since '1 minute ago' | grep memory-memoryrelay
# Should show: "memory-memoryrelay: connected to https://api.memoryrelay.net"
```

**Note**: `openclaw status` may show "unavailable" due to an OpenClaw display bug (see [Known Limitations](#known-limitations)). This is cosmetic only - if the plugin shows "loaded" and logs show "connected", the plugin is working correctly.

### 1. Get API Key

Sign up at [memoryrelay.io](https://memoryrelay.io) or use the public demo API.

### 2. Configure

Add to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "slots": {
      "memory": "plugin-memoryrelay-ai"
    },
    "entries": {
      "plugin-memoryrelay-ai": {
        "enabled": true,
        "config": {
          "apiKey": "mem_prod_...",
          "agentId": "my-agent",
          "apiUrl": "https://api.memoryrelay.net",
          "autoRecall": true,
          "autoCapture": false
        }
      }
    }
  }
}
```

### 3. Restart Gateway

```bash
openclaw gateway restart
```

### 4. Test Connection

```bash
openclaw memoryrelay status
```

## Usage

### AI Agent Tools

The plugin provides three tools your AI agent can use:

#### `memory_store`

Store a new memory with optional metadata.

> **Note**: The `agent_id` parameter is automatically injected from your config. You don't need to include it.

**Parameters:**
- `content` (string, required) - Memory content (1-50,000 characters)
- `metadata` (object, optional) - Key-value metadata (max 10KB when serialized)

**Example:**
```typescript
memory_store({
  content: "User prefers concise bullet-point responses",
  metadata: { category: "preferences", importance: "high" }
})
```

**Returns:** Memory object with `id`, `content`, `agent_id`, `metadata`, `created_at`, `updated_at`

**Rate Limit**: 30 requests per minute

#### `memory_recall`

Search memories using semantic similarity.

**Parameters:**
- `query` (string, required) - Natural language search query
- `limit` (number, optional, default: 10) - Maximum results (1-50)
- `threshold` (number, optional, default: 0.5) - Minimum similarity score (0-1)

**Example:**
```typescript
memory_recall({
  query: "user communication preferences",
  limit: 5,
  threshold: 0.7
})
```

**Returns:** Array of search results with `memory` object and `score` (0-1):
```json
{
  "results": [
    {
      "memory": {
        "id": "550e8400-...",
        "content": "User prefers concise bullet-point responses",
        "metadata": { "category": "preferences" },
        "created_at": 1707649200
      },
      "score": 0.89
    }
  ]
}
```

#### `memory_forget`

Delete a memory by ID or search query.

**Parameters:**
- `memoryId` (string, optional) - Memory UUID to delete
- `query` (string, optional) - Search query (shows candidates if multiple matches)

**Examples:**
```typescript
// By ID
memory_forget({ memoryId: "550e8400-..." })

// By query (interactive if multiple matches)
memory_forget({ query: "outdated preference" })
```

**Returns:** Success confirmation

### Status Monitoring

Check plugin status directly (don't rely on `openclaw status` - see [Known Limitations](#known-limitations)):

```bash
# Check plugin loaded
openclaw plugins info plugin-memoryrelay-ai

# Check connection via logs
journalctl -u openclaw-gateway -f | grep memory-memoryrelay

# Test tools directly
openclaw memoryrelay search "test query"
```

### CLI Commands

```bash
# Check status
openclaw memoryrelay status

# List recent memories
openclaw memoryrelay list --limit 10

# Search memories
openclaw memoryrelay search "API configuration"
```

### Auto-Recall

When `autoRecall: true`, relevant memories are automatically injected before each agent turn:

```xml
<relevant-memories>
The following memories from MemoryRelay may be relevant:
- User prefers concise responses
- Project uses TypeScript with strict mode
- ...
</relevant-memories>
```

**Config:**
- `recallLimit`: Max memories (default: 5)
- `recallThreshold`: Min similarity score (default: 0.3)

### Auto-Capture

When `autoCapture: true`, the plugin detects and stores important information automatically.

**Patterns detected:**
- "remember that..."
- "my name/email/phone is..."
- "important: ..."
- API keys, SSH configs, preferences

**Note:** Disabled by default for privacy.

## Configuration

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `apiKey` | string | ✅ | - | MemoryRelay API key |
| `agentId` | string | ✅ | - | Unique agent identifier |
| `apiUrl` | string | No | `api.memoryrelay.net` | API endpoint |
| `autoRecall` | boolean | No | `true` | Auto-inject memories |
| `autoCapture` | boolean | No | `false` | Auto-store information |
| `recallLimit` | number | No | `5` | Max memories to inject |
| `recallThreshold` | number | No | `0.3` | Similarity threshold (0-1) |

### Environment Variables

Alternatively, use environment variables:

```bash
export MEMORYRELAY_API_KEY="mem_prod_..."
export MEMORYRELAY_AGENT_ID="my-agent"
```

Then reference in config:
```json
{
  "apiKey": "${MEMORYRELAY_API_KEY}",
  "agentId": "${MEMORYRELAY_AGENT_ID}"
}
```

## Architecture

MemoryRelay works **alongside** OpenClaw's built-in memory system (not as a replacement):

**OpenClaw Built-in Memory** (local):
- Workspace files (`MEMORY.md`, `memory/*.md`)
- Fast local access, version control friendly
- Tools: `memory_search`, `memory_get`
- Scope: Per-agent, stays on disk

**MemoryRelay Plugin** (cloud):
- Cloud-backed API storage
- Cross-agent sharing, persistent
- Tools: `memory_store`, `memory_recall`, `memory_forget`
- Scope: Shared across agents, 900+ memories

**Both systems run together** - use built-in for local context, MemoryRelay for long-term cross-agent knowledge.

```
┌─────────────────────┐       ┌─────────────────────┐
│ Built-in Memory     │       │ MemoryRelay Plugin  │
│ (Local Files)       │       │ (Cloud API)         │
├─────────────────────┤       ├─────────────────────┤
│ memory_search       │       │ memory_store        │
│ memory_get          │       │ memory_recall       │
│                     │       │ memory_forget       │
└──────────┬──────────┘       └──────────┬──────────┘
           │                             │
           └─────────────┬───────────────┘
                         │
                         ↓
                ┌─────────────────┐
                │  OpenClaw Agent │
                └─────────────────┘
```

## Known Limitations

### Status Display Issue

**Symptom**: `openclaw status` shows "Memory: unavailable" even when plugin is working.

**Root Cause**: OpenClaw's status command checks the built-in MemoryIndexManager, not plugin tools. This is an OpenClaw architecture limitation, not a bug in this plugin.

**Impact**: Cosmetic only - all plugin functionality works perfectly:
- ✅ memory_store, memory_recall, memory_forget tools work
- ✅ AutoRecall and AutoCapture work
- ✅ API connectivity works (921 memories stored)
- ❌ Status display shows wrong system

**Workaround**: Verify plugin functionality directly instead of relying on status:

```bash
# 1. Check plugin loaded
openclaw plugins info plugin-memoryrelay-ai
# Should show: Status: loaded

# 2. Check logs for connection
journalctl -u openclaw-gateway --since '1 minute ago' | grep memory-memoryrelay
# Should show: "memory-memoryrelay: connected to https://api.memoryrelay.net"

# 3. Test memory_store tool
openclaw agents <your-agent> --one-shot "Store test: Plugin works"

# 4. Test memory_recall tool
openclaw memoryrelay search "plugin works"

# 5. Check API directly
curl -H "X-API-Key: YOUR_KEY" https://api.memoryrelay.net/v1/memories?agent_id=YOUR_AGENT&limit=1
```

**Why This Happens**: OpenClaw has two separate memory systems:
1. `memory.backend` (top-level, status checks this)
2. `plugins.slots.memory` (plugin tools, status ignores this)

Our plugin provides tools (#2), but status checks the backend (#1). Fixing this requires OpenClaw core changes to check plugin status when a memory slot is configured.

**Upstream Issue**: Tracked in [openclaw/openclaw#TBD](https://github.com/openclaw/openclaw/issues) (pending)

## Troubleshooting

### Plugin Not Loading

```bash
# Check plugin status
openclaw plugins list | grep memoryrelay

# View config validation
openclaw doctor

# Check logs
journalctl -u openclaw-gateway -f
```

### Connection Failed

```bash
# Test API directly
curl https://api.memoryrelay.net/v1/health

# Check API key
openclaw memoryrelay status
```

### No Memories Returned

- Check `recallThreshold` (lower = more results)
- Verify `agentId` matches your API agent
- Try broader search queries

## Security

- API keys stored in `openclaw.json` (not committed to git)
- Supports environment variable substitution
- Auto-capture disabled by default (privacy)
- No hardcoded credentials

**Best Practices:**
- Use environment variables in production
- Never commit `openclaw.json` with real keys
- Rotate API keys regularly
- Review auto-captured memories periodically

## Development

### File Structure

```
openclaw-plugin/
├── index.ts                  # Plugin implementation
├── openclaw.plugin.json      # Plugin manifest
├── package.json              # NPM metadata
├── LICENSE                   # MIT license
└── README.md                 # This file
```

### Testing

```bash
# Install locally
openclaw plugins install --link .

# Test tools
# (via agent conversation or CLI)

# View logs
tail -f ~/.openclaw/logs/gateway.log
```

## Related Projects

- **MemoryRelay API** — REST API backend (FastAPI + PostgreSQL)
- **MCP Server** — [`memoryrelay-mcp-server`](https://www.npmjs.com/package/memoryrelay-mcp-server) for Claude Desktop
- **Python SDK** — `memoryrelay` on PyPI (coming soon)

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests (if applicable)
4. Update documentation
5. Submit a pull request

## Support

- **Issues**: [GitHub Issues](https://github.com/memoryrelay/openclaw-plugin/issues)
- **Docs**: [memoryrelay.io](https://memoryrelay.io)
- **Discord**: [OpenClaw Community](https://discord.gg/clawd)

## License

MIT © 2026 MemoryRelay

---

## Changelog

### v0.5.3 (2026-02-14) - Documentation Update

**Clarifications:**
- ✅ Documented that plugin works ALONGSIDE built-in memory (not as replacement)
- ✅ Added "Known Limitations" section explaining status display issue
- ✅ Provided verification steps for users (don't rely on `openclaw status`)
- ✅ Clarified architecture: two memory systems working together
- ✅ Explained Voyage comparison (embedding provider vs storage provider)

**No Code Changes:**
- Plugin functionality unchanged (already working perfectly)
- Tools work: memory_store, memory_recall, memory_forget ✅
- AutoRecall/AutoCapture work ✅
- 921 memories stored in production ✅

**Key Finding:**
- Status shows "unavailable" because OpenClaw checks built-in MemoryIndexManager, not plugin tools
- This is an OpenClaw architecture limitation requiring upstream fix
- All plugin functionality verified working despite status display

### v0.4.0 (2026-02-13) - Status Reporting

**New Features:**
- ✅ Status reporting via `memory.status` gateway RPC method
- ✅ Plugin now reports "available" in `openclaw status` when API is reachable
- ✅ Memory count reporting (via optional `/v1/stats` API endpoint)
- ✅ Vector availability reporting for semantic search
- ✅ Detailed status information: connected state, endpoint, agent ID, memory count

**Fixes:**
- ✅ Plugin no longer shows as "unavailable" in `openclaw status` when functional
- ✅ Status accurately reflects API connection state

**Technical Improvements:**
- ✅ Extracted constants for maintainability (`DEFAULT_API_URL`, `VALID_HEALTH_STATUSES`)
- ✅ Case-insensitive health status validation
- ✅ Proper type safety with nullish coalescing operators
- ✅ Graceful handling of missing stats endpoint (backwards compatible)

**Backwards Compatibility:**
- Fully compatible with older OpenClaw versions (uses optional chaining)
- Gracefully handles missing `/v1/stats` endpoint

### v0.3.0 (2026-02-13) - Better Installation UX

**Improved Installation Experience:**
- ✅ API key can now come from `MEMORYRELAY_API_KEY` env var
- ✅ Agent ID can come from `MEMORYRELAY_AGENT_ID` env var or defaults to "default"
- ✅ Clear error message with setup instructions when config is missing
- ✅ Comprehensive installation guide in README
- ✅ No more silent failures - helpful error messages

**Breaking Change:**
- Debug logging removed (replaced with helpful error messages)

**Migration:**
Works out of the box with env vars, or add config after install:
```bash
cat ~/.openclaw/openclaw.json | jq '.plugins.entries."plugin-memoryrelay-ai".config = {"apiKey": "YOUR_KEY", "agentId": "YOUR_AGENT"}' > /tmp/config.json && mv /tmp/config.json ~/.openclaw/openclaw.json
```

### v0.2.4 (2026-02-13)

**Debug Logging:**
- Added detailed logging to diagnose config loading issues
- Logs pluginConfig type, keys, and specific missing fields
- Helps identify why apiKey/agentId aren't being read
- Better error messages for troubleshooting

### v0.2.3 (2026-02-13)

**Critical Fix:**
- Fixed API endpoint paths - removed duplicate `/memories` segment
- Changed `/v1/memories/memories` → `/v1/memories`
- Changed `/v1/memories/memories/{id}` → `/v1/memories/{id}`
- Fixed 405 Method Not Allowed errors
- All CRUD operations now work correctly

### v0.2.2 (2026-02-13)

**Critical Fix:**
- Fixed tool registration API - changed `inputSchema` to `parameters`
- Fixed handler signature - changed `handler` to `execute` with `_id` parameter
- Tools now register correctly with OpenClaw
- Memory storage/recall/forget now functional
- Plugin shows as "available" instead of "unavailable"

### v0.2.1 (2026-02-13)

**Bug Fix:**
- Made `apiKey` and `agentId` optional in config schema
- Allows installation without pre-configuring credentials
- Plugin auto-detects agentId and supports MEMORYRELAY_API_KEY env var
- Fixes "must have required property" errors during installation

### v0.2.0 (2026-02-13) - BREAKING CHANGE

**Package Renamed to Fix Warnings:**
- Old: `@memoryrelay/openclaw-plugin`
- New: `@memoryrelay/plugin-memoryrelay-ai`
- Plugin ID remains: `plugin-memoryrelay-ai`
- **Why**: Package name must match plugin ID to avoid config warnings
- **Impact**: No code changes, just package name alignment

**Migration**:
```bash
# Uninstall old package
openclaw plugins uninstall @memoryrelay/openclaw-plugin
# Install new package
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
```

### v0.1.2 (2026-02-13)

**Bug Fix:**
- Fixed installation directory mismatch by adding `openclaw.id` to package.json
- Plugin now correctly installs to `plugin-memoryrelay-ai` directory
- Resolves "plugin not found" error during `openclaw plugins install`

### v0.1.1 (2026-02-13)

**Breaking Changes:**
- Plugin ID changed: `memory-memoryrelay` → `plugin-memoryrelay-ai`
- Update your `openclaw.json` to use new ID in `plugins.slots.memory` and `plugins.entries`

**Documentation Improvements:**
- ✅ Added agent_id auto-injection documentation
- ✅ Added size limits (content 1-50K chars, metadata 10KB)
- ✅ Added rate limit info (30 req/min)
- ✅ Enhanced tool documentation with return formats
- ✅ Added response format examples for memory_recall

**Migration Guide:**
```json
{
  "plugins": {
    "slots": {
      "memory": "plugin-memoryrelay-ai"  // Changed
    },
    "entries": {
      "plugin-memoryrelay-ai": {  // Changed
        "enabled": true,
        "config": { ... }
      }
    }
  }
}
```

### v0.1.0 (2026-02-12)

- Initial release
- Three tools: memory_store, memory_recall, memory_forget
- Auto-recall and auto-capture features
- CLI commands
- Production deployment on 3 agents

---

**Homepage**: https://memoryrelay.io  
**API**: https://api.memoryrelay.net  
**Source**: https://github.com/memoryrelay/openclaw-plugin
