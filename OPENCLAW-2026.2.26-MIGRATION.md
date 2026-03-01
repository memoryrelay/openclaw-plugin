# MemoryRelay Plugin - OpenClaw 2026.2.26 Migration

## Issue
OpenClaw 2026.2.26 introduced stricter plugin security:
- Error: `extension entry escapes package directory: ./`
- Plugin loading failed with previous configuration

## Root Cause
OpenClaw 2026.2.26 security policy rejects:
- ❌ `"extensions": ["./"]` - Directory reference (even package root)
- ❌ `"extensions": ["extensions"]` - Relative directory paths
- ❌ Missing `extensions` field entirely

## Solution
Use file-level extension paths (official pattern):
- ✅ `"extensions": ["./index.ts"]` - Direct file reference

## Changes Made

### package.json
```json
{
  "openclaw": {
    "id": "plugin-memoryrelay-ai",
    "extensions": ["./index.ts"]  // ← Changed from ["./"]
  }
}
```

### Installation Method
```bash
# Old (npm global install - doesn't work):
sudo npm install -g @memoryrelay/plugin-memoryrelay-ai

# New (OpenClaw CLI):
openclaw plugins install --link ~/.openclaw/workspace/plugin-improvements
```

### Configuration
```bash
# Add config:
openclaw config set plugins.entries.plugin-memoryrelay-ai.config '{
  "apiKey": "mem_prod_...",
  "agentId": "jarvis",
  "autoRecall": true,
  "autoCapture": false,
  "recallLimit": 5
}'

# Restart gateway:
openclaw gateway restart
```

## Version History

### v0.6.0
- Initial enhanced version with retry logic and environment variable fallback

### v0.6.1
- Removed `extensions` field (attempt to fix security error) - **FAILED**

### v0.6.2 ✅
- Fixed with `"extensions": ["./index.ts"]` pattern
- Successfully loaded in OpenClaw 2026.2.26

## Verification

```bash
# Check plugin status:
openclaw plugins info plugin-memoryrelay-ai

# Expected output:
# Status: loaded
# Source: ~/.openclaw/workspace/plugin-improvements/index.ts
# Version: 0.6.2
# [plugins] memory-memoryrelay: connected to https://api.memoryrelay.net
# [plugins] memory-memoryrelay: plugin loaded (autoRecall: true, autoCapture: false)

# Verify memory slot:
openclaw config get plugins.slots.memory
# Expected: plugin-memoryrelay-ai
```

## Key Learnings

1. **Extensions must point to files, not directories** - Even `"./"` is rejected
2. **Official plugins use `"./index.ts"`** - Check `/usr/lib/node_modules/openclaw/extensions/` for examples
3. **Use `openclaw plugins install`** - Not `npm install -g`
4. **Use `openclaw plugins list`** - Verify plugin discovery before config changes
5. **Config validation is strict** - Plugins must be discovered before adding to `allow` list

## Official Plugin Pattern

```json
{
  "name": "@openclaw/telegram",
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

## Migration Checklist

- [x] Update `package.json` openclaw.extensions to file path
- [x] Uninstall old npm global package
- [x] Install with `openclaw plugins install --link`
- [x] Verify plugin in `openclaw plugins list`
- [x] Add configuration via `openclaw config set`
- [x] Restart gateway
- [x] Verify connection to MemoryRelay API

## Status

✅ **WORKING** - Plugin v0.6.2 loaded and connected (March 1, 2026)
