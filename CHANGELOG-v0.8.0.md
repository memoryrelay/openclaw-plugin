# Changelog - v0.8.0

**Release Date**: March 5, 2026  
**Type**: Feature Release (Enhanced Debug & Status)

---

## 🎯 Overview

Version 0.8.0 adds comprehensive debugging and enhanced status reporting to the OpenClaw plugin, making it easier to troubleshoot issues and understand API behavior.

---

## ✨ New Features

### Debug Mode
- **API Call Logging**: Track all MemoryRelay API calls with timestamps, duration, and status
- **Request/Response Capture**: Optional verbose mode captures full request/response bodies
- **In-Memory Buffer**: Circular buffer keeps recent logs accessible (configurable size)
- **File Logging**: Optional file output for persistent logs
- **Multiple Query Methods**: Get recent logs, logs by tool, or errors only
- **Statistics**: Calculate success rate, average duration, total calls

### Enhanced Status Reporting
- **Tool Breakdown**: See which tools are working/failing by category
- **Connection Status**: Monitor API connection health and response time
- **Configuration Display**: View all plugin settings at a glance
- **Recent Activity**: Display last 10 API calls with duration and status
- **Known Issues Tracking**: Automatic tracking of tool failures with timestamps
- **Formatted Output**: Beautiful CLI output with Unicode symbols (✓✗⚠)
- **Performance Metrics**: Track API call duration and success rates

---

## 📝 Configuration

### New Config Options

```typescript
interface MemoryRelayConfig {
  // ... existing fields
  debug?: boolean;          // Enable debug logging (default: false)
  verbose?: boolean;        // Include request/response bodies (default: false)
  logFile?: string;         // Optional file path for logs
  maxLogEntries?: number;   // Circular buffer size (default: 100)
}
```

### Example Configuration

```json
{
  "plugins": {
    "entries": {
      "plugin-memoryrelay-ai": {
        "enabled": true,
        "config": {
          "apiKey": "mem_prod_xxxxx",
          "agentId": "jarvis",
          "autoRecall": true,
          "debug": true,
          "verbose": false,
          "logFile": "~/.openclaw/logs/memoryrelay-debug.log",
          "maxLogEntries": 1000
        }
      }
    }
  }
}
```

---

## 📊 Enhanced Status Output

### Before (v0.7.0)
```
available: true
connected: true
endpoint: https://api.memoryrelay.net
memoryCount: 256
```

### After (v0.8.0)
```
MemoryRelay Plugin Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONNECTION
  Status:        ✓ connected
  Endpoint:      https://api.memoryrelay.net
  Response Time: 45ms
  Last Check:    3/5/2026, 7:28:15 PM

CONFIGURATION
  Agent ID:      jarvis
  Auto-Recall:   ✓ Enabled (limit: 5, threshold: 0.3)
  Auto-Capture:  ✗ Disabled
  Default Project: memoryrelay-openclaw

MEMORY STATISTICS
  Total Memories: 256

TOOLS STATUS (25/39 working)
  ✓ Memory: 7/9 working
    ✗ memory_batch_store (500 error)
    ✗ memory_context (405 not implemented)
  ⚠ Entity: 1/4 working
    ✗ entity_create (422 validation)
  ✓ Project: 10/10 working
  ✓ Pattern: 3/4 working
  ⚠ Decision: 2/4 working
  ⚠ Session: 1/4 working
  ✓ Agent: 3/3 working

RECENT ACTIVITY (last 10 calls)
  7:28:15 PM  memory_store      142ms  ✓
  7:28:10 PM  memory_recall     78ms   ✓
  7:27:58 PM  project_context   156ms  ✓

KNOWN ISSUES (3)
  ⚠ memory_batch_store - 500 Internal Server Error (since 2h ago)
  ⚠ decision_record - 422 Validation Error (since 1h ago)
  ⚠ session_start - 422 Validation Error (since 1h ago)

For detailed logs, run: openclaw memoryrelay logs
For troubleshooting: https://github.com/MemoryRelay/api/issues/213
```

---

## 🔧 Technical Changes

### New Classes

#### `DebugLogger` (src/debug-logger.ts)
- 175 lines of TypeScript
- Circular buffer implementation
- Multiple query methods
- Formatted output utilities

#### `StatusReporter` (src/status-reporter.ts)
- 310 lines of TypeScript
- Tool failure tracking
- Comprehensive report generation
- Formatted CLI output

### Modified Files

#### `index.ts`
- Added debug/verbose config options
- Instrumented API client with logging
- Enhanced status handler with full report
- Tool name extraction from API paths
- Success/failure tracking for all API calls

---

## 📈 Benefits

### For Users
- ✅ Better understanding of plugin status
- ✅ Easy troubleshooting with debug logs
- ✅ Clear visibility into which tools work
- ✅ Proactive issue detection

### For Developers
- ✅ Comprehensive API call history
- ✅ Request/response inspection
- ✅ Performance metrics
- ✅ Better bug reports with context

### For MemoryRelay Team
- ✅ Better issue reports from users
- ✅ API usage patterns visibility
- ✅ Performance feedback
- ✅ Feature adoption metrics

---

## 🔄 Migration Guide

### From v0.7.0 to v0.8.0

**No breaking changes!** All new features are opt-in.

**To enable debug mode:**

1. Edit `~/.openclaw/openclaw.json`
2. Add debug options to config:
   ```json
   {
     "debug": true,
     "verbose": false,
     "maxLogEntries": 100
   }
   ```
3. Restart gateway: `openclaw gateway restart`

**Status reporting automatically enhanced** - no config needed!

---

## 🐛 Bug Fixes

None - this is a pure feature release.

---

## 📚 Documentation

- **ENHANCEMENT_PLAN.md**: Complete 5-phase implementation plan
- **IMPLEMENTATION_SUMMARY_PHASE1.md**: Phase 1 summary
- **IMPLEMENTATION_SUMMARY_PHASE2.md**: Phase 2 integration summary (this release)
- **VALIDATION_PLAN.md**: Testing methodology
- **VALIDATION_REPORT.md**: Validation results (v0.7.0)

---

## 🧪 Testing

- ✅ All 73 existing tests passing
- ✅ No regressions introduced
- ✅ Backward compatible with v0.7.0 configs

---

## 🚀 Next Steps

**Phase 3** (CLI Commands) - Coming Soon:
- `openclaw memoryrelay logs` - View debug logs
- `openclaw memoryrelay test` - Test individual tools
- `openclaw memoryrelay health` - Run comprehensive health check
- `openclaw memoryrelay metrics` - View performance metrics

---

## 📦 Upgrade

```bash
# Via OpenClaw CLI
openclaw plugins upgrade @memoryrelay/plugin-memoryrelay-ai

# Via npm
npm update -g @memoryrelay/plugin-memoryrelay-ai

# Restart gateway
openclaw gateway restart
```

---

## 🔗 Links

- **Repository**: https://github.com/MemoryRelay/openclaw-plugin
- **NPM Package**: https://www.npmjs.com/package/@memoryrelay/plugin-memoryrelay-ai
- **MemoryRelay API**: https://api.memoryrelay.net
- **Documentation**: https://memoryrelay.ai
- **Issue Tracker**: https://github.com/MemoryRelay/api/issues

---

**Contributors**: Jarvis (AI Agent), Dominic (Product Owner)  
**License**: MIT
