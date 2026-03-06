# OpenClaw Plugin Enhancement Plan: Debug & Status Improvements

**Date**: March 5, 2026  
**Project**: memoryrelay-openclaw  
**Goal**: Add comprehensive debugging and status reporting to OpenClaw plugin  

---

## Overview

Enhance the OpenClaw plugin with:
1. Better `openclaw status` output (detailed, human-readable)
2. Debug mode for verbose API call logging
3. Request/response tracing for troubleshooting
4. Performance metrics tracking

---

## Current State

### Status Reporting (`memory.status`)
**Location**: `index.ts` lines 712-748

**Current Output**:
```typescript
{
  available: boolean,
  connected: boolean,
  endpoint: string,
  memoryCount: number,
  agentId: string,
  vector: { available: boolean, enabled: boolean },
  error?: string
}
```

**Issues**:
1. No tool breakdown (which tools are working/failing)
2. No recent API call history
3. No performance metrics
4. No configuration display
5. Error messages not user-friendly

---

## Proposed Enhancements

### 1. Enhanced Status Output ✨

**New Status Structure**:
```typescript
{
  // Connection Status
  connection: {
    status: "connected" | "disconnected" | "degraded",
    endpoint: string,
    lastCheck: string,  // ISO timestamp
    responseTime: number // ms
  },
  
  // Configuration
  config: {
    agentId: string,
    autoRecall: boolean,
    autoCapture: boolean,
    recallLimit: number,
    recallThreshold: number,
    excludeChannels: string[],
    defaultProject?: string
  },
  
  // Memory Statistics
  stats: {
    total_memories: number,
    memories_today: number,
    last_stored: string,  // ISO timestamp
    search_count_24h: number
  },
  
  // Tool Status (39 tools)
  tools: {
    memory: { enabled: 9, available: 7, failed: 2 },
    entity: { enabled: 4, available: 1, failed: 3 },
    agent: { enabled: 3, available: 3, failed: 0 },
    session: { enabled: 4, available: 1, failed: 3 },
    decision: { enabled: 4, available: 2, failed: 2 },
    pattern: { enabled: 4, available: 3, failed: 1 },
    project: { enabled: 10, available: 10, failed: 0 },
    health: { enabled: 1, available: 1, failed: 0 }
  },
  
  // Recent Activity (last 10 API calls)
  recentCalls: [
    {
      tool: "memory_store",
      timestamp: "2026-03-05T18:41:50Z",
      duration: 142,  // ms
      status: "success" | "error",
      error?: string
    }
  ],
  
  // Known Issues
  issues: [
    { tool: "memory_batch_store", error: "500 Internal Server Error", since: "2026-03-05T18:25:00Z" },
    { tool: "decision_record", error: "422 Validation Error", since: "2026-03-05T18:30:00Z" }
  ]
}
```

**CLI Output Example**:
```
MemoryRelay Plugin Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONNECTION
  Status:       ✓ Connected
  Endpoint:     https://api.memoryrelay.net
  Response Time: 45ms
  Last Check:   2026-03-05 18:41:50

CONFIGURATION
  Agent ID:     jarvis
  Auto-Recall:  ✓ Enabled (limit: 5, threshold: 0.3)
  Auto-Capture: ✗ Disabled
  Default Project: memoryrelay-openclaw

MEMORY STATISTICS
  Total Memories: 256
  Today:          12
  Last Stored:    2 minutes ago
  Searches (24h): 87

TOOLS STATUS (25/39 working)
  ✓ Memory Operations: 7/9 working
    ✗ memory_batch_store (500 error)
    ✗ memory_context (405 not implemented)
  
  ⚠ Entity Management: 1/4 working
    ✗ entity_create (422 validation)
    ✗ entity_link (not tested)
    ✗ entity_graph (not tested)
  
  ✓ Project Workflow: 10/10 working
  ✓ Pattern Library: 3/4 working
  ⚠ Decision Tracking: 2/4 working
  ⚠ Session Management: 1/4 working
  ✓ Agent Management: 3/3 working

RECENT ACTIVITY (last 5 calls)
  18:41:50  memory_store      142ms  ✓ success
  18:41:45  memory_recall     78ms   ✓ success
  18:41:30  project_context   156ms  ✓ success
  18:41:15  memory_store      139ms  ✓ success
  18:40:58  memory_list       92ms   ✓ success

KNOWN ISSUES (3)
  ⚠ memory_batch_store - 500 Internal Server Error (since 2h ago)
  ⚠ decision_record - 422 Validation Error (since 1h ago)
  ⚠ session_start - 422 Validation Error (since 1h ago)

For detailed logs, run: openclaw status --debug
For troubleshooting: https://github.com/MemoryRelay/api/issues/213
```

---

### 2. Debug Mode 🔍

**Configuration**:
```typescript
interface MemoryRelayConfig {
  // ... existing fields
  debug?: boolean;          // Enable debug logging
  verbose?: boolean;        // Extra verbose (includes request/response bodies)
  logFile?: string;         // Optional file path for debug logs
  maxLogEntries?: number;   // Max entries in memory (default: 100)
}
```

**Debug Logger Implementation**:
```typescript
class DebugLogger {
  private logs: LogEntry[] = [];
  private maxEntries: number;
  private logFile?: string;
  
  log(entry: LogEntry) {
    this.logs.push(entry);
    if (this.logs.length > this.maxEntries) {
      this.logs.shift();
    }
    if (this.logFile) {
      this.writeToFile(entry);
    }
  }
  
  getRecentLogs(limit: number = 10): LogEntry[] {
    return this.logs.slice(-limit);
  }
}

interface LogEntry {
  timestamp: string;
  tool: string;
  method: string;
  path: string;
  duration: number;
  status: "success" | "error";
  requestBody?: unknown;
  responseBody?: unknown;
  error?: string;
  retries?: number;
}
```

**Instrumented API Client**:
```typescript
async request<T>(
  method: string,
  path: string,
  body?: unknown,
  retryCount: number = 0
): Promise<T> {
  const startTime = Date.now();
  const toolName = this.extractToolName(path);
  
  try {
    // ... existing request logic
    
    const duration = Date.now() - startTime;
    
    if (this.debug) {
      this.logger.log({
        timestamp: new Date().toISOString(),
        tool: toolName,
        method,
        path,
        duration,
        status: "success",
        requestBody: this.verbose ? body : undefined,
        responseBody: this.verbose ? result : undefined,
        retries: retryCount
      });
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    if (this.debug) {
      this.logger.log({
        timestamp: new Date().toISOString(),
        tool: toolName,
        method,
        path,
        duration,
        status: "error",
        requestBody: this.verbose ? body : undefined,
        error: String(error),
        retries: retryCount
      });
    }
    
    throw error;
  }
}
```

---

### 3. CLI Commands 🛠️

**New Commands**:

#### `openclaw memoryrelay status [--debug] [--verbose]`
```bash
# Standard status
openclaw memoryrelay status

# With debug info
openclaw memoryrelay status --debug

# With full request/response logs
openclaw memoryrelay status --verbose
```

#### `openclaw memoryrelay logs [--limit N] [--tool NAME]`
```bash
# Last 20 API calls
openclaw memoryrelay logs --limit 20

# Last 10 memory_store calls
openclaw memoryrelay logs --tool memory_store --limit 10
```

#### `openclaw memoryrelay test [--tool NAME]`
```bash
# Test all tools
openclaw memoryrelay test

# Test specific tool
openclaw memoryrelay test --tool memory_store

# Output:
# Testing memory_store...
#   ✓ API call successful (142ms)
#   ✓ Response validation passed
#   ✓ Data structure correct
```

#### `openclaw memoryrelay health`
```bash
# Comprehensive health check
openclaw memoryrelay health

# Output:
# MemoryRelay Health Check
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# API Endpoint:     ✓ Reachable (45ms)
# Authentication:   ✓ Valid API key
# Database:         ✓ Connected
# Redis Cache:      ✓ Connected
# Embeddings:       ⚠ Not checked
# 
# Tool Tests (39 total):
#   ✓ memory_store (142ms)
#   ✓ memory_recall (78ms)
#   ✗ memory_batch_store (500 error)
#   ...
# 
# Overall Status: Degraded (25/39 tools working)
```

---

### 4. Performance Metrics 📊

**Tracked Metrics**:
```typescript
interface PerformanceMetrics {
  // API Call Statistics
  apiCalls: {
    total: number,
    successful: number,
    failed: number,
    avgDuration: number,
    p95Duration: number,
    p99Duration: number
  },
  
  // Per-Tool Metrics
  toolMetrics: {
    [toolName: string]: {
      calls: number,
      successes: number,
      failures: number,
      avgDuration: number,
      lastError?: string,
      lastSuccess?: string
    }
  },
  
  // Auto-Recall Metrics
  autoRecall: {
    triggers: number,
    memoriesInjected: number,
    avgMemoriesPerTrigger: number,
    avgSearchDuration: number
  },
  
  // Rate Limiting
  rateLimit: {
    requestsThisMinute: number,
    limit: number,
    throttledRequests: number
  }
}
```

**CLI Command**:
```bash
openclaw memoryrelay metrics

# Output:
# MemoryRelay Performance Metrics
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
# API CALLS (last 24h)
#   Total:      1,247
#   Successful: 1,198 (96.1%)
#   Failed:     49 (3.9%)
#   Avg Time:   132ms
#   P95 Time:   289ms
#   P99 Time:   456ms
# 
# TOP TOOLS (by call count)
#   memory_store:    456 calls, 98.2% success, 139ms avg
#   memory_recall:   387 calls, 100% success, 78ms avg
#   project_context: 142 calls, 100% success, 156ms avg
# 
# AUTO-RECALL
#   Triggers:    1,247
#   Avg Memories: 3.4
#   Avg Duration: 78ms
# 
# RATE LIMITING
#   This Minute:  23/100
#   Throttled:    0
```

---

## Implementation Plan

### Phase 1: Enhanced Status (2-3 hours)
1. Create `StatusReporter` class
2. Implement tool status tracking
3. Add recent activity log
4. Create formatted CLI output
5. Test with current plugin

### Phase 2: Debug Mode (2-3 hours)
1. Create `DebugLogger` class
2. Instrument API client with logging
3. Add request/response capture
4. Implement log file writing
5. Add debug CLI commands

### Phase 3: Performance Metrics (2-3 hours)
1. Create `MetricsCollector` class
2. Track API call statistics
3. Calculate percentiles (p95, p99)
4. Add per-tool metrics
5. Create metrics CLI command

### Phase 4: CLI Commands (1-2 hours)
1. Implement `memoryrelay logs` command
2. Implement `memoryrelay test` command
3. Implement `memoryrelay health` command
4. Implement `memoryrelay metrics` command
5. Update README with new commands

### Phase 5: Testing & Documentation (1-2 hours)
1. Write unit tests for new features
2. Update CHANGELOG.md
3. Update README.md
4. Create PR for MemoryRelay/openclaw-plugin

**Total Effort**: 8-13 hours

---

## File Structure

```
openclaw-plugin/
├── src/
│   ├── index.ts              # Main plugin (existing)
│   ├── debug-logger.ts       # NEW: Debug logging
│   ├── status-reporter.ts    # NEW: Status reporting
│   ├── metrics-collector.ts  # NEW: Performance metrics
│   ├── api-client.ts         # EXTRACT: Instrumented API client
│   └── types.ts              # EXTRACT: Shared types
├── tests/
│   ├── debug-logger.test.ts
│   ├── status-reporter.test.ts
│   └── metrics-collector.test.ts
├── ENHANCEMENT_PLAN.md       # THIS FILE
└── README.md                 # UPDATE: New CLI commands
```

---

## Configuration Example

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
          "autoCapture": false,
          "recallLimit": 5,
          "recallThreshold": 0.3,
          
          // NEW: Debug options
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

## Benefits

### For Users
1. ✅ Better understanding of plugin status
2. ✅ Easy troubleshooting with debug logs
3. ✅ Performance visibility
4. ✅ Proactive issue detection

### For Developers
1. ✅ Comprehensive API call history
2. ✅ Request/response inspection
3. ✅ Performance bottleneck identification
4. ✅ Better bug reports from users

### For MemoryRelay Team
1. ✅ Better issue reports with full context
2. ✅ API usage patterns visibility
3. ✅ Performance feedback loop
4. ✅ Feature adoption metrics

---

## Success Metrics

**Before**:
- `openclaw status` shows "unavailable" (misleading)
- No debug information available
- Users can't troubleshoot issues
- No performance visibility

**After**:
- Detailed, accurate status reporting
- Comprehensive debug logging with request/response capture
- Easy troubleshooting with CLI commands
- Performance metrics for optimization

---

## References

- GitHub Issue #213: https://github.com/memoryrelay/api/issues/213
- OpenClaw Plugin Repo: https://github.com/MemoryRelay/openclaw-plugin
- Validation Report: ~/.openclaw/workspace/openclaw-plugin/VALIDATION_REPORT.md

---

**Status**: Ready for implementation  
**Priority**: High (improves user experience + debugging)  
**Breaking Changes**: None (all additions, backwards compatible)
