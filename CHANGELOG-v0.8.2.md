# Changelog - v0.8.2

**Release Date**: March 5, 2026
**Focus**: Enhanced Gateway Log Readability

## Overview

v0.8.2 improves the human readability of OpenClaw gateway logs when debug mode is enabled. Previously, logs showed only counts ("injecting 5 memories") without details, and the detailed data was only available in the debug log file. Now, gateway logs display useful previews and performance indicators directly.

## What's New

### Enhanced Auto-Recall Logging

When `debug: true`, auto-recall now shows memory previews with similarity scores:

**Before (v0.8.1)**:
```
memory-memoryrelay: injecting 5 memories into context
```

**After (v0.8.2)**:
```
memory-memoryrelay: injecting 5 memories into context:
  • [0.89] OpenClaw Plugin Enhancement Phase 2 COMPLETE (March 5, 2026, 7:26-7:30 PM EST): Successfully...
  • [0.85] OpenClaw Plugin v0.8.1 upgrade complete (March 5, 2026, 8:29 PM EST): Successfully upgraded...
  • [0.82] MemoryRelay openclaw-plugin Repository - OpenClaw Integration (Feb 17, 2026)...
  • [0.78] OpenClaw Plugin Enhancement Phase 5 COMPLETE (March 5, 2026, 7:50-7:56 PM EST): Documentation...
  • [0.75] OpenClaw Plugin Enhancement Phase 1 COMPLETE (March 5, 2026, 7:15-7:25 PM EST): Created...
```

**Features**:
- Similarity scores (0-1) shown in brackets
- First 100 chars of each memory displayed
- Ellipsis (`...`) added for truncated content
- Newlines replaced with spaces for clean single-line preview

### Enhanced API Call Logging

API calls now show performance indicators:

**Examples**:
```
memory-memoryrelay: memory_store → 189ms ✓
memory-memoryrelay: memory_recall → 523ms ✓ (slow)
memory-memoryrelay: project_context → 1234ms ✓ (SLOW)
memory-memoryrelay: memory_get → 404 Not Found
memory-memoryrelay: memory_store → 422 Unprocessable Entity (retry 1/3)
```

**Features**:
- Tool name clearly visible
- Duration in milliseconds
- Success indicator (✓) or error status
- Performance warnings:
  - `(slow)` for 500-1000ms
  - `(SLOW)` for >1000ms
- Retry count shown for failed requests
- HTTP status codes and error messages

### Gateway vs Debug Log File

**Gateway Logs** (`/tmp/openclaw/openclaw-2026-03-05.log`):
- Human-readable summaries
- Memory previews (100 chars)
- Performance indicators
- Suitable for real-time monitoring

**Debug Log File** (`~/.openclaw/memoryrelay-debug.log`):
- Full JSON entries with complete data
- Request and response bodies (when `verbose: true`)
- Machine-parseable for analysis
- Complete memory content (not truncated)

## Configuration

No configuration changes required. Enhanced logging activates automatically when:
```json
{
  "debug": true
}
```

To see full request/response bodies in the debug file (not gateway logs):
```json
{
  "debug": true,
  "verbose": true
}
```

## Technical Details

### Changes to `index.ts`

**1. Auto-Recall Logging Enhancement** (line ~3300):
```typescript
// Enhanced gateway logging (v0.8.2): Show memory previews
if (cfg?.debug) {
  const snippets = results
    .map((r) => {
      const preview = r.memory.content.substring(0, 100).replace(/\n/g, ' ');
      const ellipsis = r.memory.content.length > 100 ? '...' : '';
      return `  • [${r.score.toFixed(2)}] ${preview}${ellipsis}`;
    })
    .join('\n');
  api.logger.info?.(
    `memory-memoryrelay: injecting ${results.length} memories into context:\n${snippets}`,
  );
} else {
  api.logger.info?.(
    `memory-memoryrelay: injecting ${results.length} memories into context`,
  );
}
```

**2. API Success Logging Enhancement** (line ~270):
```typescript
// Enhanced gateway logging (v0.8.2): Readable API call summary
if (this.config.debug && this.api) {
  const statusSymbol = response.status < 400 ? '✓' : '✗';
  const durationColor = duration > 1000 ? ' (SLOW)' : duration > 500 ? ' (slow)' : '';
  this.api.logger.info?.(
    `memory-memoryrelay: ${toolName} → ${duration}ms ${statusSymbol}${durationColor}`
  );
}
```

**3. API Error Logging Enhancement** (line ~230):
```typescript
// Enhanced gateway logging (v0.8.2): Readable error summary
if (this.config.debug && this.api) {
  const retryMsg = retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : '';
  this.api.logger.warn?.(
    `memory-memoryrelay: ${toolName} → ${response.status} ${errorMsg || response.statusText}${retryMsg}`
  );
}
```

## Migration from v0.8.1

No breaking changes. Upgrade seamlessly:

```bash
# Uninstall old version
npm uninstall -g @memoryrelay/plugin-memoryrelay-ai

# Install new version
npm install -g @memoryrelay/plugin-memoryrelay-ai@0.8.2

# Restart gateway
openclaw gateway restart
```

Configuration remains unchanged. If you already have `debug: true`, enhanced logging will activate immediately.

## Use Cases

### Debugging Auto-Recall Behavior
See exactly which memories are being injected and their relevance scores to understand why certain memories appear in context.

### Performance Monitoring
Identify slow API calls at a glance. If you see consistent `(SLOW)` indicators, investigate:
- Network latency to MemoryRelay API
- Large query sizes
- API rate limiting

### Error Diagnosis
Quickly spot failed API calls and their status codes without parsing JSON logs. Retry indicators help identify transient vs persistent errors.

## Backward Compatibility

- ✅ **100% backward compatible with v0.8.1**
- ✅ **No configuration changes required**
- ✅ **Debug log file format unchanged** (JSON structure preserved)
- ✅ **All 39 tools work identically**
- ✅ **Auto-recall/auto-capture behavior unchanged**

## Known Limitations

### Gateway Log Truncation
Memory previews in gateway logs are limited to 100 characters. For full content:
- Check `<relevant-memories>` in agent context
- Read debug log file with `cat ~/.openclaw/memoryrelay-debug.log | jq`

### JSON Log Format
Gateway logs are still emitted as JSON by OpenClaw core. The enhanced messages appear as human-readable strings within the JSON structure:
```json
{"0": "memory-memoryrelay: memory_store → 189ms ✓", "1": "...", "_meta": {...}}
```

For cleaner output, use:
```bash
tail -f /tmp/openclaw/openclaw-*.log | grep memory-memoryrelay | jq -r '."0"'
```

## Statistics

- **Lines changed**: ~40 (3 enhancements)
- **Files modified**: 2 (`index.ts`, `package.json`)
- **New features**: 3 (auto-recall preview, API timing, error formatting)
- **Breaking changes**: 0
- **Development time**: 15 minutes

## What's Next

### v0.9.0 (Planned)
- Implement gateway methods for CLI commands (`memoryrelay.logs`, `memoryrelay.health`, etc.)
- Make CLI commands functional (currently documentation wrappers)
- Add real-time debug log streaming via WebSocket

### Future Enhancements
- Configurable preview length for gateway logs
- Color-coded performance indicators (when terminal supports colors)
- Memory category badges in preview (e.g., `[credentials]`, `[commands]`)
- Auto-recall analytics (average score, cache hit rate)

## Feedback

Report issues or suggest improvements:
- GitHub: https://github.com/memoryrelay/openclaw-plugin/issues
- Documentation: https://memoryrelay.ai/docs/openclaw-plugin

---

**Release Type**: Minor (feature addition, no breaking changes)  
**Upgrade Priority**: Low (quality-of-life improvement, optional)  
**Rollback Safety**: Safe (can downgrade to v0.8.1 without data loss)
