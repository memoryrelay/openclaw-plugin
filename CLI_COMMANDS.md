# CLI Commands Guide

**Version**: 0.8.0  
**Added**: March 5, 2026

---

## Overview

The MemoryRelay OpenClaw plugin provides CLI commands for debugging, testing, and monitoring the plugin's operation.

---

## Commands

### 1. memoryrelay-logs

View debug logs from the MemoryRelay plugin.

**Usage**:
```bash
memoryrelay-logs [--limit N] [--tool NAME] [--errors-only]
```

**Options**:
- `--limit=N` - Number of log entries to show (default: 20)
- `--tool=NAME` - Filter by specific tool name
- `--errors-only` - Show only error logs

**Examples**:
```bash
# Show last 20 logs
memoryrelay-logs

# Show last 50 logs
memoryrelay-logs --limit=50

# Show logs for memory_store tool
memoryrelay-logs --tool=memory_store --limit=10

# Show only errors
memoryrelay-logs --errors-only
```

**Requirements**:
- Debug mode must be enabled in plugin config (`debug: true`)

**Output Format**:
```
TIMESTAMP          TOOL                    DURATION  STATUS  ERROR
━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━  ━━━━━━  ━━━━━━━━━━━━━━━━━━━
7:35:15 PM        memory_store              142ms  ✓      
7:35:10 PM        memory_recall              78ms  ✓      
7:35:05 PM        memory_batch_store        245ms  ✗      500 Internal Server Error
```

---

### 2. memoryrelay-health

Run comprehensive health check on the MemoryRelay plugin.

**Usage**:
```bash
memoryrelay-health [--detailed]
```

**Options**:
- `--detailed` - Show detailed test results (future enhancement)

**Examples**:
```bash
# Run basic health check
memoryrelay-health

# Run detailed health check
memoryrelay-health --detailed
```

**Tests Performed**:
1. API endpoint reachability
2. Authentication (API key validation)
3. Core tools:
   - `memory_store` - Store and delete test memory
   - `memory_recall` - Search functionality
   - `memory_list` - List recent memories

**Output Format**:
```json
{
  "api": {
    "status": "healthy",
    "endpoint": "https://api.memoryrelay.net",
    "responseTime": 45,
    "reachable": true
  },
  "authentication": {
    "status": "valid",
    "apiKey": "mem_prod_xxxxx..."
  },
  "tools": {
    "memory_store": { "status": "working", "duration": 142 },
    "memory_recall": { "status": "working", "duration": 78 },
    "memory_list": { "status": "working", "duration": 92 }
  },
  "overall": "healthy"
}
```

**Status Values**:
- `healthy` - All systems operational
- `degraded` - Some tools failing but core functionality working
- `unhealthy` - Critical failure

---

### 3. memoryrelay-test

Test individual MemoryRelay tools.

**Usage**:
```bash
memoryrelay-test --tool=NAME
```

**Options**:
- `--tool=NAME` - Tool name to test (required)

**Available Tools**:
- `memory_store` - Store and delete a test memory
- `memory_recall` - Search for memories
- `memory_list` - List recent memories
- `project_list` - List projects
- `memory_health` - Check API health

**Examples**:
```bash
# Test memory storage
memoryrelay-test --tool=memory_store

# Test search functionality
memoryrelay-test --tool=memory_recall

# Test API health
memoryrelay-test --tool=memory_health
```

**Output Format**:
```json
{
  "tool": "memory_store",
  "duration": 142,
  "result": {
    "success": true,
    "message": "Memory stored and deleted successfully"
  }
}
```

---

### 4. memoryrelay-metrics

View performance metrics for the MemoryRelay plugin.

**Usage**:
```bash
memoryrelay-metrics
```

**Requirements**:
- Debug mode must be enabled (`debug: true`)
- Plugin must have processed API calls

**Output Format**:
```
MemoryRelay Performance Metrics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

API CALLS (last 24h)
  Total:      1,247
  Successful: 1,198 (96.1%)
  Failed:     49 (3.9%)
  Avg Time:   132ms
  P95 Time:   289ms
  P99 Time:   456ms

TOP TOOLS (by call count)
  memory_store:    456 calls, 98.2% success, 139ms avg
  memory_recall:   387 calls, 100% success, 78ms avg
  project_context: 142 calls, 100% success, 156ms avg
```

**JSON Output**:
```json
{
  "summary": {
    "total": 1247,
    "successful": 1198,
    "failed": 49,
    "successRate": 96.1,
    "avgDuration": 132
  },
  "toolMetrics": {
    "memory_store": {
      "calls": 456,
      "successes": 448,
      "failures": 8,
      "avgDuration": 139,
      "successRate": 98,
      "p95Duration": 289,
      "p99Duration": 456
    }
  }
}
```

---

## Gateway Method Calls

All CLI commands are implemented as gateway methods that can be called directly:

### memoryrelay.logs
```bash
openclaw gateway call memoryrelay.logs '{"limit": 20, "tool": "memory_store"}'
```

### memoryrelay.health
```bash
openclaw gateway call memoryrelay.health
```

### memoryrelay.test
```bash
openclaw gateway call memoryrelay.test '{"tool": "memory_store"}'
```

### memoryrelay.metrics
```bash
openclaw gateway call memoryrelay.metrics
```

---

## Configuration

Enable debug mode to use all CLI features:

```json
{
  "plugins": {
    "entries": {
      "plugin-memoryrelay-ai": {
        "enabled": true,
        "config": {
          "apiKey": "mem_prod_xxxxx",
          "agentId": "jarvis",
          "debug": true,
          "verbose": false,
          "maxLogEntries": 1000
        }
      }
    }
  }
}
```

**Debug Options**:
- `debug`: boolean - Enable debug logging (required for logs/metrics)
- `verbose`: boolean - Include request/response bodies in logs
- `logFile`: string - Optional file path for persistent logs
- `maxLogEntries`: number - Circular buffer size (default: 100)

---

## Troubleshooting

### "Debug mode not enabled"

**Problem**: Commands return empty results or error

**Solution**: Enable debug mode in config:
```json
{
  "debug": true
}
```

Then restart gateway:
```bash
openclaw gateway restart
```

### "No logs available"

**Problem**: memoryrelay-logs shows no entries

**Causes**:
1. Debug mode recently enabled (no logs accumulated yet)
2. maxLogEntries too small
3. Plugin not actively used

**Solution**: Use the plugin to generate logs, then check again

### "Health check fails"

**Problem**: memoryrelay-health reports "unhealthy"

**Causes**:
1. API endpoint unreachable
2. Invalid API key
3. Network issues
4. MemoryRelay API down

**Solution**: Check:
```bash
# Test API directly
curl -H "X-API-Key: YOUR_KEY" https://api.memoryrelay.net/v1/health

# Check gateway logs
openclaw gateway logs | grep memoryrelay

# Verify config
cat ~/.openclaw/openclaw.json | jq '.plugins.entries."plugin-memoryrelay-ai".config'
```

---

## Examples

### Debug Workflow

1. **Enable debug mode**:
   ```bash
   # Edit config
   vim ~/.openclaw/openclaw.json
   
   # Add "debug": true
   
   # Restart gateway
   openclaw gateway restart
   ```

2. **Use the plugin** (generate logs)

3. **View logs**:
   ```bash
   memoryrelay-logs --limit=50
   ```

4. **Check specific tool**:
   ```bash
   memoryrelay-logs --tool=memory_store
   ```

5. **View metrics**:
   ```bash
   memoryrelay-metrics
   ```

### Health Check Workflow

1. **Run health check**:
   ```bash
   memoryrelay-health
   ```

2. **If issues found, test specific tools**:
   ```bash
   memoryrelay-test --tool=memory_store
   memoryrelay-test --tool=memory_recall
   ```

3. **Check logs for errors**:
   ```bash
   memoryrelay-logs --errors-only
   ```

### Performance Analysis

1. **View overall metrics**:
   ```bash
   memoryrelay-metrics
   ```

2. **Identify slow tools** (check avgDuration, p95Duration)

3. **View logs for slow tool**:
   ```bash
   memoryrelay-logs --tool=slow_tool_name --limit=100
   ```

4. **Check for patterns** (retries, specific errors)

---

## Future Enhancements

**Planned for Phase 4** (Testing + Documentation):
- [ ] Add `--json` flag for machine-readable output
- [ ] Add `--follow` flag for real-time log streaming
- [ ] Add `--since` flag for time-based filtering
- [ ] Add `--export` flag to save logs/metrics to file
- [ ] Add `--detailed` mode for health check with all 39 tools
- [ ] Add comparison mode for metrics (compare time periods)

---

## References

- **Enhancement Plan**: ENHANCEMENT_PLAN.md
- **Phase 3 Summary**: IMPLEMENTATION_SUMMARY_PHASE3.md
- **Changelog**: CHANGELOG-v0.8.0.md
- **Plugin Docs**: README.md
