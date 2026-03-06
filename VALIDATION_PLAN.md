# OpenClaw Plugin Validation Plan

**Date**: March 5, 2026  
**Project**: memoryrelay-openclaw  
**Plugin Version**: 0.7.0  
**Status**: MemoryRelay API Fixed (6:14 PM EST)  

## Pre-Validation Status

✅ **MemoryRelay API Working**
- memory_store() tested successfully
- Issue #210 resolved
- Write operations restored

✅ **Existing Tests Passing**
- 73/73 tests passing (via vitest)
- Test duration: ~500ms
- Test file: index.test.ts (1012 lines, 112 test cases total)

✅ **Repository Cloned**
- Location: ~/.openclaw/workspace/openclaw-plugin
- Version: 0.7.0
- Dependencies installed (node_modules present)

## Validation Objectives

### 1. Core Plugin Functionality
- [ ] Plugin loads correctly in OpenClaw
- [ ] Configuration via openclaw.json works
- [ ] API connection establishes successfully
- [ ] Auto-recall system injects memories correctly
- [ ] Workflow instructions appear in agent context

### 2. Tool Group Testing (39 tools across 8 groups)

#### Memory Tools (9 tools)
- [ ] memory_store - Store memories with project scoping
- [ ] memory_recall - Semantic search
- [ ] memory_forget - Delete by ID or query
- [ ] memory_list - Pagination
- [ ] memory_get - Retrieve by ID
- [ ] memory_update - Update content
- [ ] memory_batch_store - Bulk storage
- [ ] memory_context - Token-aware context window
- [ ] memory_promote - Update importance/tier

#### Entity Tools (4 tools)
- [ ] entity_create - Create named entities
- [ ] entity_link - Link entity to memory
- [ ] entity_list - List entities
- [ ] entity_graph - Explore knowledge graph

#### Agent Tools (3 tools)
- [ ] agent_list - List agents
- [ ] agent_create - Create agent
- [ ] agent_get - Get agent details

#### Session Tools (4 tools)
- [ ] session_start - Begin work session
- [ ] session_end - End with summary
- [ ] session_recall - Get session details
- [ ] session_list - List sessions

#### Decision Tools (4 tools)
- [ ] decision_record - Record architectural decision
- [ ] decision_list - List decisions
- [ ] decision_supersede - Replace old decision
- [ ] decision_check - Check existing decisions

#### Pattern Tools (4 tools)
- [ ] pattern_create - Create reusable pattern
- [ ] pattern_search - Search patterns
- [ ] pattern_adopt - Adopt pattern for project
- [ ] pattern_suggest - Get pattern suggestions

#### Project Tools (9 tools)
- [ ] project_register - Register new project
- [ ] project_list - List projects
- [ ] project_info - Get project details
- [ ] project_add_relationship - Link projects
- [ ] project_dependencies - List dependencies
- [ ] project_dependents - List dependents
- [ ] project_related - List all relationships
- [ ] project_impact - Analyze change impact
- [ ] project_shared_patterns - Find shared patterns

#### System Tools (2 tools)
- [ ] project_context - Load full project context
- [ ] memory_health - Check API health

### 3. Integration Testing

#### OpenClaw Integration
- [ ] Plugin shows in `openclaw plugins list`
- [ ] Plugin status shows "loaded"
- [ ] Gateway logs show "connected to api.memoryrelay.net"
- [ ] Tools appear in agent's available tools list
- [ ] Workflow instructions injected into context

#### Auto-Recall System
- [ ] Memories automatically injected before agent turn
- [ ] Injection respects recallLimit config
- [ ] Injection respects recallThreshold config
- [ ] XML format correct: `<relevant-memories>`
- [ ] Memories sorted by relevance (score)

#### Project-First Workflow
- [ ] Workflow instructions in `before_agent_start` hook
- [ ] Instructions mention project_context() first
- [ ] Instructions mention session_start()
- [ ] Instructions mention decision_check()
- [ ] Instructions mention pattern_search()

### 4. API Bug Verification (Issues #207 & #210)

#### Issue #207: project_id Parameter
- [ ] memory_store() with project parameter works
- [ ] Stored memory has correct project_id (not null)
- [ ] project_context() returns memories for project
- [ ] project_info() shows accurate memory_count

#### Issue #210: Memory Write 500 Errors
- [ ] memory_store() doesn't return 500
- [ ] memory_batch_store() works
- [ ] All write operations stable

### 5. Error Handling & Edge Cases

#### API Errors
- [ ] 401 Unauthorized handled gracefully
- [ ] 422 Validation errors show clear messages
- [ ] 500 Internal Server Error retries/fails gracefully
- [ ] Network timeouts handled

#### Input Validation
- [ ] Content length limits enforced (50KB)
- [ ] Metadata size limits enforced (10KB)
- [ ] Invalid UUIDs rejected
- [ ] Missing required fields caught

#### Rate Limiting
- [ ] memory_store rate limit (30 req/min) handled
- [ ] Bulk operations respect limits
- [ ] Rate limit errors show clear guidance

### 6. Documentation & Examples

- [ ] README.md accurate and up-to-date
- [ ] Configuration examples work
- [ ] Tool descriptions clear
- [ ] Examples directory functional (if present)

## Test Execution Plan

### Phase 1: Plugin Loading (Est. 10 min)
1. Check current plugin status
2. Verify gateway logs show connection
3. Test basic tool invocation (memory_health)
4. Confirm 39 tools accessible

### Phase 2: Core Memory Operations (Est. 20 min)
1. memory_store with project parameter
2. memory_recall semantic search
3. memory_list pagination
4. memory_get by ID
5. memory_update content
6. memory_forget deletion

### Phase 3: Project Workflow (Est. 15 min)
1. project_register new test project
2. project_context load context
3. Store memories associated with project
4. Verify project_id not null (Issue #207 fix)

### Phase 4: Advanced Features (Est. 25 min)
1. decision_record + decision_check
2. pattern_create + pattern_search
3. session_start + session_end
4. entity_create + entity_link + entity_graph

### Phase 5: Auto-Recall Testing (Est. 15 min)
1. Store test memories
2. Trigger agent turn
3. Verify memories injected in context
4. Test threshold filtering

### Phase 6: Stress Testing (Est. 15 min)
1. Batch operations (memory_batch_store)
2. Large content (near 50KB limit)
3. Rate limit behavior
4. Concurrent requests

## Success Criteria

✅ **Minimum Viable**:
- All 73 existing tests pass
- memory_store() works with project parameter
- project_id not null after storage
- Auto-recall injects memories correctly
- No 500 errors on write operations

✅ **Full Production Ready**:
- All 39 tools functional
- Project workflow complete
- Decision tracking works
- Pattern library operational
- Session tracking functional
- Error handling robust
- Documentation accurate

## Known Issues to Verify Fixed

1. **Issue #207**: POST /v1/memories ignores project_id
   - **Fix deployed**: March 5, 2026 ~4:57 PM EST
   - **Test**: Store memory with project, verify project_id not null

2. **Issue #210**: POST /v1/memories returns 500 errors
   - **Fix deployed**: March 5, 2026 ~6:14 PM EST
   - **Test**: All memory write operations succeed

3. **session_start 422 validation errors**
   - **Status**: Still failing (tested at 6:14 PM)
   - **Test**: Determine required fields, fix validation

## Test Environment

- **OpenClaw Version**: 2026.2.26+
- **Plugin Version**: 0.7.0
- **API Endpoint**: https://api.memoryrelay.net
- **API Version**: 0.2.0
- **Agent**: jarvis
- **Test Project**: memoryrelay-openclaw (ID: 703faf19-266d-4a74-a962-fc4ffd4119bf)

## Execution Timeline

- **Start**: March 5, 2026, 6:15 PM EST
- **Estimated Duration**: 1.5-2 hours
- **Target Completion**: March 5, 2026, 8:00 PM EST

## Deliverables

1. **Validation Report** - Comprehensive test results
2. **Bug List** - Any issues discovered
3. **Documentation Updates** - Corrections to README if needed
4. **Memory Storage** - Key findings stored in MemoryRelay
5. **Git Commits** - Documentation and any fixes

---

**Status**: Ready to begin Phase 1 (Plugin Loading)
