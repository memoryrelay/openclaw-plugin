# Changelog - v0.8.4

**Release Date**: March 5, 2026  
**Focus**: OpenClaw Security Compliance

## Overview

v0.8.4 removes file logging to comply with OpenClaw 2026.3.2+ security validation. Debug logs are now in-memory only. The plugin now installs cleanly via `openclaw plugins install` without security warnings.

## Critical Change

### File Logging Removed

**Problem**: OpenClaw's static code analysis detected filesystem operations (`fs.appendFileSync`) and flagged the plugin as potentially unsafe, blocking npm installation.

**Solution**: Removed all filesystem operations. Debug logs are now stored in a circular in-memory buffer only.

**What this means**:
- ✅ Clean installation via `openclaw plugins install`
- ✅ No security warnings during installation
- ❌ Debug logs not persisted to disk
- ⏳ Gateway methods for log access coming in v0.9.0

## Migration from v0.8.3

**If you had logFile configured:**

```json
// v0.8.3 (no longer works)
{
  "plugins": {
    "entries": {
      "plugin-memoryrelay-ai": {
        "config": {
          "debug": true,
          "logFile": "memoryrelay-debug.log"  // ❌ Deprecated
        }
      }
    }
  }
}
```

**Remove logFile (v0.8.4):**

```json
// v0.8.4 (in-memory only)
{
  "plugins": {
    "entries": {
      "plugin-memoryrelay-ai": {
        "config": {
          "debug": true,
          "maxLogEntries": 1000  // Circular buffer size
        }
      }
    }
  }
}
```

**Deprecation warning**: If `logFile` is still present in config, you'll see:
```
memoryrelay: logFile is deprecated and ignored. Use gateway methods to access debug logs (coming in v0.9.0)
```

## What Still Works

- ✅ **In-memory debug logging**: Circular buffer stores last N entries (default: 100, max: 10,000)
- ✅ **Enhanced gateway logs** (v0.8.2): Memory previews, performance indicators
- ✅ **Status reporting**: Tool statistics, failure tracking
- ✅ **All 39 tools**: memory, entity, agent, session, decision, pattern, project operations
- ✅ **Auto-recall/auto-capture**: Automatic context injection
- ✅ **Verbose mode**: Request/response capture (in-memory)

## Accessing Debug Logs (v0.8.4)

### Option 1: Gateway Logs (Real-time)

```bash
# Watch gateway logs for MemoryRelay activity
tail -f /tmp/openclaw/openclaw-*.log | grep memory-memoryrelay
```

**Output (v0.8.2+ enhanced logging)**:
```
memory-memoryrelay: injecting 5 memories into context:
  • [0.89] OpenClaw Plugin Enhancement Phase 2 COMPLETE...
  • [0.85] OpenClaw Plugin v0.8.1 upgrade complete...
memory-memoryrelay: memory_store → 189ms ✓
memory-memoryrelay: memory_recall → 523ms ✓ (slow)
```

### Option 2: CLI Commands (Coming in v0.9.0)

```bash
# Future: Access in-memory logs via gateway methods
openclaw memoryrelay-logs --limit 50
openclaw memoryrelay-metrics
openclaw memoryrelay-health
```

**Status**: Planned for v0.9.0. CLI commands currently show documentation only.

### Option 3: Gateway RPC (Coming in v0.9.0)

```typescript
// Future: Programmatic access
const logs = await api.gateway.call('memoryrelay.logs', { limit: 100 });
const health = await api.gateway.call('memoryrelay.health');
```

## Installation (v0.8.4)

### Clean Install

```bash
$ openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
Downloading @memoryrelay/plugin-memoryrelay-ai…
Extracting...
✓ Installed plugin-memoryrelay-ai (0.8.4)
```

**No warnings, no errors!** ✅

### Upgrade from v0.8.3

```bash
# Update existing installation
openclaw plugins update plugin-memoryrelay-ai

# Restart gateway
openclaw gateway restart
```

### Config Changes Required

If you used `logFile`:
1. Remove it from config (or leave it - will be ignored with warning)
2. Optionally increase `maxLogEntries` for larger in-memory buffer
3. Restart gateway

## Technical Details

### Code Changes

**src/debug-logger.ts**:
- Removed `fs` module import
- Removed `writeToFile()` method
- Removed `logFile` handling logic
- Added deprecation warning if `logFile` provided
- ~30 lines removed

**index.ts**:
- Removed logFile path validation logic (~40 lines)
- Simplified DebugLogger initialization
- Updated startup log message

**Files Modified**:
- `src/debug-logger.ts` (~30 lines removed)
- `index.ts` (~40 lines removed)
- `package.json` (version bump)
- `openclaw.plugin.json` (version bump, schema update)
- `CHANGELOG-v0.8.4.md` (this file)

### Security Compliance

**OpenClaw 2026.3.2+ Security Checks**:
- ✅ No filesystem write operations
- ✅ No absolute path references
- ✅ No path traversal attempts
- ✅ Environment variables for API keys (expected, safe)
- ✅ HTTPS-only API communication

**Removed Security Warnings**:
- ~~Invalid path: must stay within extensions directory~~
- ~~Plugin contains dangerous code patterns: filesystem access~~

**Remaining Warning (Expected & Safe)**:
```
WARNING: Plugin contains dangerous code patterns: 
Environment variable access combined with network send
```

This is **intentional and secure**:
- Reading `MEMORYRELAY_API_KEY` env var is documented feature
- API key sent over HTTPS to api.memoryrelay.net (legitimate auth)
- Standard pattern for API authentication plugins

## What's Unchanged

- ✅ All 92 tests passing
- ✅ All 39 tools work identically
- ✅ Auto-recall/auto-capture behavior unchanged
- ✅ Enhanced gateway logging (v0.8.2 features)
- ✅ Debug mode captures same data (in-memory)
- ✅ Zero breaking changes to plugin functionality
- ✅ Config schema backward compatible

## Known Limitations

### No Persistent Logs

Debug logs are lost on gateway restart. Solutions:

**Option A**: Use enhanced gateway logs (sufficient for most debugging)
```bash
tail -f /tmp/openclaw/openclaw-*.log | grep memory-memoryrelay | tee memoryrelay.log
```

**Option B**: Wait for v0.9.0 gateway methods

### Memory Usage

In-memory circular buffer grows with `maxLogEntries`:
- Default (100 entries): ~50KB memory
- Max (10,000 entries): ~5MB memory

For normal use (100-1000 entries), memory impact is negligible.

## Roadmap

### v0.9.0 (Next Release)

**Gateway Methods**:
- `memoryrelay.logs` - Retrieve in-memory logs
- `memoryrelay.health` - Connection + API status
- `memoryrelay.metrics` - Performance statistics
- `memoryrelay.export` - Export logs as JSON

**CLI Commands (Functional)**:
- `openclaw memoryrelay-logs`
- `openclaw memoryrelay-health`
- `openclaw memoryrelay-metrics`
- `openclaw memoryrelay-test`

**Real-time Streaming**:
- WebSocket endpoint for live log streaming
- Dashboard integration

### v0.9.1+ (Future)

**Advanced Features**:
- Log filtering and search
- Configurable log levels (DEBUG, INFO, WARN, ERROR)
- Performance profiling and bottleneck detection
- Memory recall quality metrics

## Feedback

Report issues or suggest improvements:
- GitHub: https://github.com/memoryrelay/openclaw-plugin/issues
- Documentation: https://memoryrelay.ai/docs/openclaw-plugin

---

**Release Type**: Patch (feature removal for compliance, no breaking changes)  
**Upgrade Priority**: High (required for clean npm installation)  
**Rollback Safety**: Safe (can downgrade to v0.8.2 if needed, but installation will fail)
