# Phase 1 Implementation Plan

**Date**: March 6, 2026
**Session**: fcb3c617-0c13-4323-8f37-341fc1a1cfd6
**Goal**: Implement all 4 Phase 1 tasks for Zero-Friction Adoption Framework

## Issues to Implement

### ✅ Issue #12: Enable Smart Auto-Capture by Default (5 min) - DONE FIRST
**Priority**: P1
**File Changes**: `index.ts` (PluginConfig interface, DEFAULT_CONFIG)
**Changes**:
1. Update `PluginConfig` interface: `autoCapture: boolean` → `autoCapture: AutoCaptureConfig | boolean`
2. Add `AutoCaptureConfig` interface with tiers, categories, privacy controls
3. Update `DEFAULT_CONFIG` to enable smart auto-capture by default
4. Add migration logic for existing boolean configs
5. Add privacy blocklist patterns
6. Add API key masking logic

###  Issue #10: Daily Memory Stats in Heartbeat (20-25 min) - DONE SECOND
**Priority**: P1  
**File Changes**: New file `src/heartbeat/daily-stats.ts`, update `index.ts`
**Changes**:
1. Create `src/heartbeat/` directory
2. Implement `morningCheck()` and `eveningReview()` functions
3. Add stats calculation logic (memory count, weekly growth, categories)
4. Add most valuable memory detection (by recall frequency)
5. Integrate with OpenClaw heartbeat OR add lifecycle hooks
6. Add configuration for timing/frequency

### Issue #11: CLI Stats Command (10-15 min) - DONE THIRD
**Priority**: P2
**File Changes**: New file `src/cli/stats-command.ts`, update `package.json`
**Changes**:
1. Create `src/cli/` directory
2. Implement `statsCommand()` with text/JSON formatting
3. Add stats fetching and aggregation logic
4. Register CLI command in plugin
5. Add documentation in README

### Issue #9: First-Run Onboarding Wizard (15-20 min) - DONE LAST
**Priority**: P1
**File Changes**: New file `src/onboarding/first-run.ts`, update `index.ts`
**Changes**:
1. Create `src/onboarding/` directory
2. Implement first-run detection (state file check + no memories)
3. Create interactive wizard flow
4. Add auto-capture opt-in prompt
5. Create state file after completion
6. Integrate with plugin initialization

## Implementation Order Rationale

1. **#12 First** - Simplest, just config changes, enables auto-capture for later features
2. **#10 Second** - Medium complexity, provides daily touchpoints
3. **#11 Third** - Simple CLI command, provides manual stats access
4. **#9 Last** - Most complex, ties everything together, needs other features working

## Critical Blockers to Address

### 1. OpenClaw Plugin API Capabilities
Need to verify:
- ✅ **Tool registration**: Confirmed working
- ❓ **Lifecycle hooks** (onFirstRun, onDailyCheck): Need to check
- ❓ **Cron jobs**: Need to check
- ❓ **UI components** (modals): Need to check

**Workaround if not available**:
- Use HEARTBEAT.md polling for daily stats
- Use state files for first-run detection
- Use CLI prompts instead of modals for onboarding

### 2. MemoryRelay API Requirements
Need to verify:
- ❓ GET /v1/memories/stats - Overall statistics
- ❓ GET /v1/memories/activity?date=YYYY-MM-DD - Daily activity
- ❓ GET /v1/memories/top-recalled?period=day - Most recalled

**Workaround if not available**:
- Track stats client-side in state file
- Calculate from existing GET /v1/memories?limit=1000

## File Structure After Implementation

```
openclaw-plugin/
├── index.ts (updated config + imports)
├── src/
│   ├── onboarding/
│   │   └── first-run.ts
│   ├── heartbeat/
│   │   └── daily-stats.ts
│   └── cli/
│       └── stats-command.ts
├── openclaw.plugin.json
├── package.json (updated with CLI command)
└── README.md (updated with new features)
```

## Testing Strategy

After each issue:
1. **Unit tests** - Test individual functions
2. **Manual test** - Install plugin locally and test feature
3. **Integration test** - Verify works with OpenClaw

After all issues:
1. **Full validation** - Run all tests
2. **CI test** - Ensure CI passes
3. **Manual smoke test** - Install and verify all 4 features work together

## Success Criteria

### Issue #12 (Config)
- [ ] autoCapture config updated to object format
- [ ] Migration logic works for boolean → object
- [ ] Default enables smart auto-capture
- [ ] Privacy blocklist implemented
- [ ] API key masking works

### Issue #10 (Daily Stats)
- [ ] Morning check generates correct stats
- [ ] Evening review shows activity
- [ ] Most valuable memory detection works
- [ ] Timing configuration works

### Issue #11 (CLI)
- [ ] Command accessible via openclaw CLI
- [ ] Text format displays correctly
- [ ] JSON format valid
- [ ] Stats calculations accurate

### Issue #9 (Onboarding)
- [ ] First-run detection works
- [ ] Wizard shows on first start
- [ ] State file created after completion
- [ ] Doesn't show on subsequent starts

## Timeline

- Issue #12: 5 minutes
- Issue #10: 25 minutes
- Issue #11: 15 minutes
- Issue #9: 20 minutes
- Testing: 15 minutes
- **Total**: ~80 minutes (1 hour 20 min)

## Next Phase

After Phase 1 is complete, tested, and CI passes:
- Create PR for review
- Merge to main
- Publish new version (v0.12.0)
- Begin Phase 2 planning
