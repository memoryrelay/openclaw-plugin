# Migration Guide: v0.7.0 → v0.8.0

**Release Date**: March 5, 2026  
**Theme**: Debug & Monitoring  
**Breaking Changes**: None ✅

---

## Overview

Version 0.8.0 is a **non-breaking release** that adds comprehensive debugging and monitoring capabilities. All existing configurations and workflows continue to work unchanged.

---

## What's New

### 1. Debug Logging System

Track every API call with detailed logging:

```json
{
  "debug": true,
  "verbose": false,
  "maxLogEntries": 1000,
  "logFile": "/var/log/memoryrelay.log"
}
```

### 2. CLI Commands

Four new commands for debugging and diagnostics:

- `memoryrelay-logs` - View debug logs
- `memoryrelay-health` - Run health checks
- `memoryrelay-test` - Test individual tools
- `memoryrelay-metrics` - View performance statistics

### 3. Enhanced Status Reporting

`memory.status` now includes:
- Tool breakdown by category
- Recent API call history
- Known issues
- Performance metrics

### 4. Gateway Methods

Four new gateway methods:
- `memoryrelay.logs`
- `memoryrelay.health`
- `memoryrelay.test`
- `memoryrelay.metrics`

---

## Migration Steps

### Step 1: Update Plugin

```bash
# Update to v0.8.0
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai@0.8.0

# Or update to latest
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai@latest
```

### Step 2: (Optional) Enable Debug Mode

Only if you need debugging capabilities:

```bash
openclaw config set plugins.entries.plugin-memoryrelay-ai.config.debug true
openclaw gateway restart
```

### Step 3: Verify Installation

```bash
# Check version
npm list -g @memoryrelay/plugin-memoryrelay-ai
# Should show 0.8.0

# Test health
memoryrelay-health

# Check logs (if debug enabled)
memoryrelay-logs --limit=10
```

---

## Configuration Changes

### New Options (All Optional)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug` | boolean | `false` | Enable debug logging |
| `verbose` | boolean | `false` | Include request/response bodies |
| `logFile` | string | — | Optional file path for logs |
| `maxLogEntries` | number | `100` | Circular buffer size |

### Example Configuration

**Before (v0.7.0)**:
```json
{
  "plugins": {
    "entries": {
      "plugin-memoryrelay-ai": {
        "enabled": true,
        "config": {
          "apiKey": "mem_prod_xxxxx",
          "agentId": "my-agent",
          "autoRecall": true
        }
      }
    }
  }
}
```

**After (v0.8.0)** - Same config works:
```json
{
  "plugins": {
    "entries": {
      "plugin-memoryrelay-ai": {
        "enabled": true,
        "config": {
          "apiKey": "mem_prod_xxxxx",
          "agentId": "my-agent",
          "autoRecall": true
        }
      }
    }
  }
}
```

**After (v0.8.0)** - With debug enabled:
```json
{
  "plugins": {
    "entries": {
      "plugin-memoryrelay-ai": {
        "enabled": true,
        "config": {
          "apiKey": "mem_prod_xxxxx",
          "agentId": "my-agent",
          "autoRecall": true,
          "debug": true,
          "verbose": false,
          "maxLogEntries": 1000
        }
      }
    }
  }
}
```

---

## Backward Compatibility

### ✅ Fully Compatible

- All v0.7.0 configurations work unchanged
- All 39 tools work identically
- Auto-recall behavior unchanged
- Tool group filtering unchanged
- Channel exclusions unchanged

### No Breaking Changes

- No API changes
- No config schema changes
- No behavior changes when debug disabled
- No performance impact when debug disabled

---

## Testing Your Migration

### 1. Basic Functionality Test

```bash
# Test memory storage
openclaw gateway call memory_store '{"content": "Migration test v0.8.0"}'

# Test memory recall
openclaw gateway call memory_recall '{"query": "migration test", "limit": 1}'

# Test project list
openclaw gateway call project_list '{"limit": 5}'
```

### 2. Debug Features Test

```bash
# Enable debug mode
openclaw config set plugins.entries.plugin-memoryrelay-ai.config.debug true
openclaw gateway restart

# Generate some activity
openclaw gateway call memory_list '{"limit": 5}'

# Check logs
memoryrelay-logs --limit=10

# Run health check
memoryrelay-health

# View metrics
memoryrelay-metrics
```

### 3. Status Reporting Test

```bash
# Check enhanced status
openclaw gateway call memory.status

# Should include:
# - Connection status
# - Tool breakdown
# - Recent calls (if debug enabled)
# - Known issues
```

---

## Performance Impact

### Without Debug Mode (Default)

- **Overhead**: ~0ms (no-op checks)
- **Memory**: No additional memory usage
- **Behavior**: Identical to v0.7.0

### With Debug Mode Enabled

- **Overhead**: ~1-2ms per API call
- **Memory**: ~10KB (100 entries) to ~100KB (1000 entries)
- **Behavior**: All API calls logged

### With Verbose Mode Enabled

- **Overhead**: ~2-5ms per API call
- **Memory**: Higher (includes request/response bodies)
- **Use case**: Deep troubleshooting only

---

## Troubleshooting

### "Debug mode not working"

**Problem**: Commands show "No logs" or fail

**Solution**:
1. Verify `debug: true` in config
2. Restart gateway: `openclaw gateway restart`
3. Generate activity to populate logs
4. Check `maxLogEntries` isn't too low

### "Commands not found"

**Problem**: `memoryrelay-logs: command not found`

**Solution**:
```bash
# Reinstall plugin
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai@0.8.0 --force

# Or use gateway methods instead
openclaw gateway call memoryrelay.logs '{"limit": 20}'
```

### "Performance degraded"

**Problem**: Plugin feels slower

**Solution**:
1. Check if `verbose: true` (disable if not needed)
2. Lower `maxLogEntries` (less memory usage)
3. Disable debug mode if not needed
4. Check `memoryrelay-metrics` for slow tools

---

## Rollback

If you encounter issues, rollback to v0.7.0:

```bash
# Uninstall v0.8.0
openclaw plugins uninstall @memoryrelay/plugin-memoryrelay-ai

# Install v0.7.0
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai@0.7.0

# Restart gateway
openclaw gateway restart
```

Your configuration will continue to work (new options will be ignored).

---

## New Use Cases

### 1. API Troubleshooting

```bash
# Enable debug
openclaw config set plugins.entries.plugin-memoryrelay-ai.config.debug true
openclaw gateway restart

# Reproduce issue
openclaw gateway call memory_store '{"content": "Test"}'

# Check logs for errors
memoryrelay-logs --errors-only

# Get full details
memoryrelay-health
```

### 2. Performance Monitoring

```bash
# Enable debug (if not already)
openclaw config set plugins.entries.plugin-memoryrelay-ai.config.debug true

# Use plugin normally

# Check metrics after some activity
memoryrelay-metrics

# Identify slow tools
memoryrelay-logs --limit=50 | grep "duration.*[5-9][0-9][0-9]ms"
```

### 3. Integration Testing

```bash
# Run health check
memoryrelay-health

# Test each critical tool
memoryrelay-test --tool=memory_store
memoryrelay-test --tool=memory_recall
memoryrelay-test --tool=project_list

# Verify all tools working
openclaw gateway call memory.status
```

---

## FAQ

### Do I need to enable debug mode?

**No.** Debug mode is optional and disabled by default. Enable it only when:
- Troubleshooting API issues
- Monitoring performance
- Debugging integration problems

### Will this affect my agent's performance?

**No.** When debug mode is disabled (default), there is zero performance impact.

### Can I use debug mode in production?

**Yes**, but consider:
- 1-2ms overhead per API call
- Memory usage for log buffer
- Disk usage if using `logFile`

For production monitoring, consider:
- Enable debug mode
- Set `verbose: false` (default)
- Use reasonable `maxLogEntries` (100-1000)
- Optional: Set `logFile` for persistence

### Will old logs persist after update?

**No.** Debug logs are in-memory only (unless you set `logFile`). Logs start fresh after:
- Gateway restart
- Plugin reload
- Buffer overflow (FIFO eviction)

### Can I export debug logs?

**Yes**, two ways:
1. Set `logFile` in config for persistent logging
2. Use `memoryrelay-logs` and redirect: `memoryrelay-logs --limit=1000 > logs.txt`

---

## Resources

- **README.md** - Updated with Debug & Monitoring section
- **CLI_COMMANDS.md** - Complete CLI usage guide
- **CHANGELOG-v0.8.0.md** - Detailed changelog
- **GitHub Issues** - Report bugs or request features

---

## Summary

✅ **Zero breaking changes**  
✅ **Backward compatible**  
✅ **Optional features**  
✅ **Minimal performance impact**  
✅ **Easy rollback**  

Version 0.8.0 adds powerful debugging capabilities without affecting existing functionality. Update when convenient, enable debug mode only when needed.

---

**Questions?** Open an issue at https://github.com/memoryrelay/openclaw-plugin/issues
