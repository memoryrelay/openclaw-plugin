# Release v0.12.3 - Session Tracking Fix

**Release Date**: March 6, 2026  
**Type**: Bug Fix  
**Priority**: High (P1)

---

## 🐛 Bug Fixes

### Session Tracking Now Works Correctly

**Issue**: Session-memory linking was broken - `session.memory_count` always stayed at 0, and memories didn't appear in session's `memories` array.

**Root Cause**: The `memory_store()` tool was incorrectly passing `session_id` nested inside the `metadata` object instead of as a top-level parameter. The MemoryRelay API expects `session_id` at the top level.

**Fix**: Modified `MemoryRelayClient.store()` to extract `session_id` from metadata and pass it as a top-level parameter.

**Before (broken)**:
```json
{
  "content": "Memory content",
  "agent_id": "agent-uuid",
  "metadata": {
    "session_id": "session-uuid",  // ❌ Wrong location
    "category": "test"
  }
}
```

**After (fixed)**:
```json
{
  "content": "Memory content",
  "agent_id": "agent-uuid",
  "session_id": "session-uuid",  // ✅ Top-level parameter
  "metadata": {
    "category": "test"
  }
}
```

**Impact**:
- ✅ `session.memory_count` now increments correctly
- ✅ Memories appear in session's `memories` array
- ✅ Session tracking workflow fully functional
- ✅ Backward compatible (no breaking changes)

**Related Issues**:
- Fixes #24 (plugin integration bug)
- Related: memoryrelay/api#226 (backend fix, already resolved)

**PR**: #25  
**Commit**: ce01da6 → f745554 (merged to main)

---

## 📦 Installation

### New Users

```bash
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
```

### Existing Users

```bash
openclaw plugins upgrade @memoryrelay/plugin-memoryrelay-ai
# OR
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai --force
```

Then restart gateway:
```bash
openclaw gateway restart
```

---

## ✅ Verification

Test that session tracking works:

```bash
# 1. Start a session
openclaw agents jarvis --one-shot "Start a test session with session_start"

# 2. Store a memory in that session
openclaw agents jarvis --one-shot "Store a memory in the current session"

# 3. Check session memory count
openclaw agents jarvis --one-shot "Recall the session we just created - memory_count should be > 0"
```

**Expected Result**: Session's `memory_count` should increment, and `memories` array should contain the stored memory.

---

## 🔄 Changelog Entry

```markdown
## [0.12.3] - 2026-03-06

### Fixed
- **Session Tracking**: Fixed session-memory linking by extracting `session_id` from metadata and passing it as a top-level parameter to the API (Fixes #24, PR #25)
  - `session.memory_count` now increments correctly
  - Memories appear in session's `memories` array
  - Backward compatible - no breaking changes
```

---

## 📊 Changes Since v0.12.2

**Files Changed**: 1  
**Lines Added**: 17  
**Lines Removed**: 3

**Modified Files**:
- `index.ts` - Updated `MemoryRelayClient.store()` method

---

## 🙏 Credits

**Reporter**: Jarvis (OpenClaw Agent)  
**Developer**: sparck75  
**Reviewer**: sparck75  
**Testing**: Backend verification completed in memoryrelay/api#226

---

## 📚 Documentation

- **README**: No changes (feature documentation still accurate)
- **API Docs**: No changes (public API unchanged)
- **Migration Guide**: Not required (backward compatible)

---

## 🔗 Links

- **GitHub Release**: https://github.com/memoryrelay/openclaw-plugin/releases/tag/v0.12.3
- **NPM Package**: https://www.npmjs.com/package/@memoryrelay/plugin-memoryrelay-ai/v/0.12.3
- **Issue #24**: https://github.com/memoryrelay/openclaw-plugin/issues/24
- **PR #25**: https://github.com/memoryrelay/openclaw-plugin/pull/25
- **Backend Issue**: https://github.com/memoryrelay/api/issues/226

---

## 🚀 Next Steps

After installing v0.12.3:

1. Test session tracking with your workflows
2. Report any issues on GitHub
3. Enjoy fully functional session-memory tracking! 🎉

---

**Full Changelog**: https://github.com/memoryrelay/openclaw-plugin/compare/v0.12.2...v0.12.3
