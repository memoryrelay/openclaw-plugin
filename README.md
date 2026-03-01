# MemoryRelay AI - OpenClaw Memory Plugin

[![npm version](https://img.shields.io/npm/v/@memoryrelay/plugin-memoryrelay-ai.svg)](https://www.npmjs.com/package/@memoryrelay/plugin-memoryrelay-ai)
[![OpenClaw Compatible](https://img.shields.io/badge/OpenClaw-2026.2.26+-blue.svg)](https://openclaw.ai)

AI-powered long-term memory with semantic search for OpenClaw agents. Store memories, recall relevant context automatically, and give your AI assistant true continuity across sessions.

## Features

- 🧠 **Semantic Search** - Vector-based memory retrieval finds relevant context by meaning, not keywords
- 🔄 **Auto-Recall** - Automatically injects relevant memories into context on every turn
- 📝 **Manual Storage** - Store important facts, preferences, and context via `memory_store` tool
- 🔍 **Smart Filtering** - Channel exclusions to keep memories private (skip group chats)
- 🛡️ **Retry Logic** - Exponential backoff with 3 attempts for network resilience
- ⚡ **Fast** - 50-150ms latency for semantic search
- 🌐 **Cloud-Backed** - Memories persist across devices and sessions

## Installation

### Requirements

- OpenClaw >= 2026.2.26
- Node.js >= 18.0.0
- MemoryRelay API key ([get one at memoryrelay.ai](https://memoryrelay.ai))

### Install via OpenClaw CLI

```bash
# Install from npm
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai

# Or install from local directory (development)
openclaw plugins install --link /path/to/plugin-improvements
```

### Configuration

```bash
# Set configuration
openclaw config set plugins.entries.plugin-memoryrelay-ai.config '{
  "apiKey": "mem_prod_your_key_here",
  "agentId": "your-agent-name",
  "autoRecall": true,
  "autoCapture": false,
  "recallLimit": 5
}'

# Or use environment variables
export MEMORYRELAY_API_KEY="mem_prod_your_key_here"
export MEMORYRELAY_AGENT_ID="your-agent-name"

# Restart gateway
openclaw gateway restart
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | (required) | MemoryRelay API key (or use `MEMORYRELAY_API_KEY` env var) |
| `agentId` | string | (required) | Unique agent identifier (or use `MEMORYRELAY_AGENT_ID` env var) |
| `apiUrl` | string | `https://api.memoryrelay.net` | MemoryRelay API endpoint |
| `autoRecall` | boolean | `true` | Automatically inject relevant memories into context |
| `autoCapture` | boolean | `false` | Automatically capture important information (privacy sensitive) |
| `recallLimit` | number | `5` | Maximum memories to inject per turn (1-20) |
| `recallThreshold` | number | `0.3` | Minimum similarity score for recall (0-1) |
| `excludeChannels` | string[] | `[]` | Channel IDs to skip auto-recall (e.g., `["telegram:group_123"]`) |

## Usage

### Memory Tools (Manual Storage)

When auto-capture is disabled (recommended), use these tools to store memories:

```typescript
// Store a memory
memory_store({
  content: "User prefers concise responses over long explanations",
  metadata: { category: "preference", topic: "communication" }
})

// Search memories
memory_recall({
  query: "communication preferences",
  limit: 5
})

// Delete a memory
memory_forget({
  memoryId: "mem_abc123"
})
```

### Auto-Recall (Automatic Context Injection)

When `autoRecall: true`, the plugin automatically searches and injects relevant memories on every turn:

```
User: "What's my API key for NorthRelay?"

[Plugin searches memories for "API key NorthRelay"]
[Injects top 5 relevant memories into context]
Agent: "Your NorthRelay API key is nr_live_..."
```

### Channel Exclusions (Privacy)

Exclude specific channels from auto-recall to keep memories private:

```json
{
  "excludeChannels": [
    "telegram:group_123456",
    "discord:channel_789012",
    "whatsapp:group_345678@g.us"
  ]
}
```

## What to Store

### ✅ Good Candidates for Memory Storage

- **API Keys & Credentials** - `"NorthRelay API key: nr_live_..."`
- **Infrastructure** - `"Production server: 51.161.10.58, SSH port 2222"`
- **Commands** - `"Deploy command: cd /opt/app && docker compose up -d"`
- **Preferences** - `"User prefers Python over JavaScript for data analysis"`
- **Project Context** - `"NorthRelay uses Next.js 16, Prisma 6, PostgreSQL 15"`
- **Lessons Learned** - `"Always run git pull before deploying to avoid conflicts"`

### ❌ Don't Store

- Routine conversation (`"how are you?"`)
- Temporary context (one-time questions)
- Already well-documented info (in README, docs)
- Personal secrets user explicitly says not to store

## Memory Lifecycle

1. **Store** - Call `memory_store` with content + metadata
2. **Recall** - MemoryRelay auto-injects on relevant turns (or manual `memory_recall`)
3. **Update** - Store again with same key to update
4. **Forget** - Call `memory_forget` to delete

## Architecture

```
┌─────────────────┐
│   OpenClaw      │
│   Agent         │
└────────┬────────┘
         │
    ┌────┴─────┐
    │  Plugin  │ ← This plugin
    └────┬─────┘
         │
         │ HTTPS (Bearer auth)
         ↓
┌─────────────────┐
│  MemoryRelay    │
│  API            │
│ (Vector Search) │
└─────────────────┘
```

## Privacy & Security

- **Cloud-Backed** - Memories stored on MemoryRelay servers (HTTPS-encrypted)
- **API Key Auth** - Bearer token authentication
- **Agent Isolation** - Memories scoped per agent ID
- **Channel Filtering** - Exclude sensitive channels from auto-recall
- **No Auto-Capture by Default** - Manual storage gives you full control

**Privacy Tip:** For ultra-sensitive data (private keys, passwords), use encrypted local files instead of cloud memory.

## CLI Commands

```bash
# Check plugin status
openclaw plugins info plugin-memoryrelay-ai

# List all plugins
openclaw plugins list

# Enable/disable
openclaw plugins enable plugin-memoryrelay-ai
openclaw plugins disable plugin-memoryrelay-ai

# Uninstall
openclaw plugins uninstall plugin-memoryrelay-ai
```

## Troubleshooting

### Plugin Not Loading

```bash
# Check if plugin is discovered
openclaw plugins list | grep memoryrelay

# Verify config
openclaw config get plugins.entries.plugin-memoryrelay-ai

# Check logs
openclaw logs --tail 100 | grep memory
```

### API Connection Issues

```bash
# Test API connection
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.memoryrelay.net/v1/memories
```

### OpenClaw 2026.2.26 Compatibility

If you see `extension entry escapes package directory`, you're using an older plugin version. Update to v0.6.2+:

```bash
openclaw plugins uninstall plugin-memoryrelay-ai
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
```

See [OPENCLAW-2026.2.26-MIGRATION.md](./OPENCLAW-2026.2.26-MIGRATION.md) for details.

## Changelog

### v0.6.2 (2026-03-01)

- **FIX**: OpenClaw 2026.2.26 compatibility - Changed `extensions` from `["./"]` to `["./index.ts"]`
- **FIX**: Plugin now installs via `openclaw plugins install` (not npm global)
- **DOCS**: Added comprehensive README and migration guide

### v0.6.1 (2026-02-18)

- Removed `extensions` field (attempted fix) - **FAILED**

### v0.6.0 (2026-02-18)

- **NEW**: Retry logic with exponential backoff (3 attempts)
- **NEW**: Request timeout (30 seconds)
- **NEW**: Environment variable fallback support (`MEMORYRELAY_API_KEY`, `MEMORYRELAY_AGENT_ID`)
- **NEW**: Channel filtering (`excludeChannels` config)
- **NEW**: Additional error handling and logging

See [CHANGELOG-v0.6.0.md](./CHANGELOG-v0.6.0.md) for details.

## Development

### Local Testing

```bash
# Clone repository
git clone https://github.com/memoryrelay/openclaw-plugin.git
cd openclaw-plugin

# Install dev dependencies
npm install

# Run tests
npm test

# Link for local testing
openclaw plugins install --link .
```

### Running Tests

```bash
npm test              # Run once
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](./LICENSE) file

## Links

- **MemoryRelay API**: https://memoryrelay.ai
- **OpenClaw Docs**: https://docs.openclaw.ai
- **Plugin Repository**: https://github.com/memoryrelay/openclaw-plugin
- **Issues**: https://github.com/memoryrelay/openclaw-plugin/issues

## Support

- **Documentation**: https://docs.memoryrelay.ai
- **Discord**: https://discord.com/invite/clawd (OpenClaw community)
- **Email**: support@memoryrelay.ai

---

Built with ❤️ for the OpenClaw community
