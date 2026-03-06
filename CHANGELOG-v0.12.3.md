# Changelog Entry for v0.12.3

## [0.12.3] - 2026-03-06

### Fixed
- **Session Tracking**: Fixed session-memory linking by extracting `session_id` from metadata and passing it as a top-level parameter to the API (Fixes #24, PR #25)
  - The `memory_store()` tool was incorrectly passing `session_id` nested inside the `metadata` object
  - Modified `MemoryRelayClient.store()` to extract `session_id` and pass it at the top level
  - `session.memory_count` now increments correctly
  - Memories appear in session's `memories` array
  - Session tracking workflow fully functional
  - Backward compatible - no breaking changes

### Technical Details

**Root Cause**: API expects `session_id` as a top-level parameter, but plugin was passing it nested in `metadata`.

**Implementation**:
```typescript
// Extract session_id from metadata if present
const { session_id, ...cleanMetadata } = metadata || {};

const payload: any = {
  content,
  agent_id: this.agentId,
  ...options,
};

// Only include metadata if non-empty
if (Object.keys(cleanMetadata).length > 0) {
  payload.metadata = cleanMetadata;
}

// Add session_id as top-level parameter
if (session_id) {
  payload.session_id = session_id;
}

return this.request<Memory>("POST", "/v1/memories", payload);
```

**Testing**: Verified with backend API (memoryrelay/api#226). Direct API calls confirmed session tracking works when `session_id` is passed at top level.

**Related Issues**:
- Fixes memoryrelay/openclaw-plugin#24
- Related memoryrelay/api#226 (backend fix, closed)

**PR**: #25  
**Commits**: ce01da6 → f745554 (merged to main)  
**Files Changed**: index.ts (+17, -3 lines)
