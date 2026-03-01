# Changelog - v0.6.2

**Release Date:** March 1, 2026  
**Breaking Changes:** None (backward compatible)  
**Migration Required:** Yes (OpenClaw 2026.2.26+ users)

## 🔧 Fixes

### OpenClaw 2026.2.26 Compatibility

**Problem:** OpenClaw 2026.2.26 tightened plugin security and rejected the previous `"extensions": ["./"]` configuration with error:

```
extension entry escapes package directory: ./
```

**Solution:** Changed extension path to point to specific file instead of directory:

```json
{
  "openclaw": {
    "extensions": ["./index.ts"]  // ✅ File path (was ["./"])
  }
}
```

### Installation Method Change

**Old (Broken):**
```bash
npm install -g @memoryrelay/plugin-memoryrelay-ai  # ❌ Not discovered by OpenClaw
```

**New (Working):**
```bash
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai  # ✅ Official method
```

## 📚 Documentation

### New Files

- **README.md** - Comprehensive installation, usage, and troubleshooting guide
- **LICENSE** - MIT License
- **OPENCLAW-2026.2.26-MIGRATION.md** - Detailed migration guide for 2026.2.26 users

### Updated Files

- **package.json** - Changed `extensions` field, updated `files` array
- **openclaw.plugin.json** - Version bump to 0.6.2

## 🔍 Technical Details

### Plugin Structure

```
plugin-memoryrelay-ai/
├── index.ts                     # Main plugin code
├── openclaw.plugin.json         # Plugin metadata
├── package.json                 # npm package config
├── README.md                    # Documentation
├── LICENSE                      # MIT License
└── OPENCLAW-2026.2.26-MIGRATION.md
```

### Extension Path Resolution

OpenClaw 2026.2.26 validates extension paths with stricter security:

- ❌ `"./"`  - Rejected (directory, even package root)
- ❌ `"extensions"` - Rejected (relative directory path)
- ❌ Missing `extensions` field - Rejected (required)
- ✅ `"./index.ts"` - Accepted (file path)

### Installation Flow

1. **Discovery** - OpenClaw scans for plugins with valid `openclaw.extensions` field
2. **Installation** - `openclaw plugins install` validates and copies/links plugin
3. **Configuration** - User sets API key and config via `openclaw config set`
4. **Loading** - Gateway loads plugin on startup, connects to MemoryRelay API

## ✅ Verification

After installing v0.6.2, verify it's working:

```bash
# Check plugin status
openclaw plugins info plugin-memoryrelay-ai

# Expected output:
# Status: loaded
# Version: 0.6.2
# [plugins] memory-memoryrelay: connected to https://api.memoryrelay.net

# Verify memory slot
openclaw config get plugins.slots.memory
# Expected: plugin-memoryrelay-ai
```

## 🚀 Migration from v0.6.0/v0.6.1

### If You're Using npm Global Install

```bash
# 1. Uninstall old version
sudo npm uninstall -g @memoryrelay/plugin-memoryrelay-ai

# 2. Remove from config (if present)
openclaw config set plugins.allow '["telegram"]'  # Adjust for your plugins

# 3. Install via OpenClaw CLI
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai

# 4. Configure
openclaw config set plugins.entries.plugin-memoryrelay-ai.config '{
  "apiKey": "mem_prod_...",
  "agentId": "your-agent",
  "autoRecall": true,
  "autoCapture": false
}'

# 5. Restart
openclaw gateway restart
```

### If You're Using Local Install (--link)

```bash
# 1. Pull latest changes
cd /path/to/plugin-improvements
git pull

# 2. Reinstall
openclaw plugins install --link .

# 3. Restart
openclaw gateway restart
```

## 🐛 Known Issues

### None

All known issues from v0.6.0 and v0.6.1 are resolved in this release.

## 📊 Testing

- ✅ Plugin loads successfully in OpenClaw 2026.2.26
- ✅ Connects to MemoryRelay API (https://api.memoryrelay.net)
- ✅ Auto-recall injects relevant memories
- ✅ Memory tools (`memory_store`, `memory_recall`, `memory_forget`) working
- ✅ Configuration via `openclaw config set` working
- ✅ Environment variable fallback working

## 🔗 References

- **OpenClaw 2026.2.26 Release Notes:** https://docs.openclaw.ai/changelog/2026.2.26
- **Plugin Development Guide:** https://docs.openclaw.ai/plugins/development
- **MemoryRelay API Docs:** https://docs.memoryrelay.ai

## 💬 Feedback

Found an issue? Have a suggestion?

- **GitHub Issues:** https://github.com/memoryrelay/openclaw-plugin/issues
- **Discord:** https://discord.com/invite/clawd (OpenClaw community)
- **Email:** support@memoryrelay.ai

---

**Next Release:** v0.7.0 (planned features: batch recall, memory categorization, export/import)
