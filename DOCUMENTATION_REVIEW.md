# Documentation Review & Corrections (v0.12.2)

**Date**: March 6, 2026  
**Reviewer**: Jarvis  
**Session**: 4741fd3e-7ec6-403a-97c1-22c42fe50678

## Executive Summary

**Issues Found**: 7 (5 critical, 2 minor)  
**Overall Status**: ⚠️ Documentation needs updates for Phase 1 features and accuracy corrections

---

## Critical Issues

### 1. ❌ Node.js Version Requirement Incorrect

**Location**: README.md line 19, package.json line 56

**Current**:
```markdown
- Node.js >= 18.0.0
```
```json
"engines": {
  "node": ">=18.0.0"
}
```

**Problem**: Node 18.x is no longer supported. CI runs Node 20.x, and dependencies require Node 20+.

**Fix**:
```markdown
- Node.js >= 20.0.0
```
```json
"engines": {
  "node": ">=20.0.0"
}
```

**Evidence**: CI workflow uses `node-version: '20.x'` (line 14, 58 of ci-cd.yml)

---

### 2. ❌ Version String Hardcoded in Plugin Code

**Location**: index.ts line 3845

**Current**:
```typescript
`memory-memoryrelay: plugin v0.12.0 loaded (39 tools, autoRecall: ${cfg?.autoRecall}, autoCapture: ${autoCaptureConfig.enabled ? autoCaptureConfig.tier : 'off'}, debug: ${debugEnabled})`,
```

**Problem**: Package version is 0.12.1 but log shows "v0.12.0"

**Fix**: Read version from package.json dynamically
```typescript
const PKG_VERSION = '0.12.1'; // Or import from package.json
`memory-memoryrelay: plugin v${PKG_VERSION} loaded (39 tools, autoRecall: ${cfg?.autoRecall}, autoCapture: ${autoCaptureConfig.enabled ? autoCaptureConfig.tier : 'off'}, debug: ${debugEnabled})`,
```

---

### 3. ❌ Phase 1 Features Not Documented

**Location**: README.md (missing section)

**Problem**: v0.12.0+ includes 4 new Phase 1 features that are completely undocumented:

1. **Smart Auto-Capture** (Issue #12)
   - Tier-based privacy system (off/conservative/smart/aggressive)
   - Privacy blocklist (passwords, SSN, credit cards, API keys)
   - First-5 confirmations mode
   - Default changed from `false` to `smart` tier

2. **Daily Memory Stats in Heartbeat** (Issue #10)
   - Morning check (9 AM) with growth stats
   - Evening review (8 PM) with most valuable memory
   - Gateway method: `memoryrelay:heartbeat`

3. **CLI Stats Command** (Issue #11)
   - Comprehensive memory statistics
   - Text/JSON output formats
   - Gateway method: `memoryrelay:stats`
   - Command: `openclaw gateway-call memoryrelay.stats`

4. **First-Run Onboarding Wizard** (Issue #9)
   - Auto-detects first-time usage
   - Creates welcome memory
   - Shows auto-capture explanation
   - Gateway method: `memoryrelay:onboarding`

**Fix**: Add new section "Phase 1: Zero-Friction Adoption Framework (v0.12.0+)" with full documentation

---

### 4. ❌ autoCapture Configuration Outdated

**Location**: README.md line 67, Configuration Options table

**Current**:
```markdown
| `autoCapture` | boolean | `false` | Auto-capture important information from conversations |
```

**Problem**: 
- Type changed from `boolean` to `boolean | AutoCaptureConfig`
- Default changed from `false` to `smart` tier
- New tier system undocumented

**Fix**:
```markdown
| `autoCapture` | boolean\|object | `{enabled: true, tier: "smart"}` | Auto-capture config. Boolean for backward compat, object for tier system (see Phase 1 features) |
```

---

### 5. ❌ Changelog Missing v0.12.0 and v0.12.1

**Location**: README.md Changelog section (line 632)

**Current**: Changelog jumps from v0.8.0 to v0.7.0

**Problem**: Missing v0.12.0 (Phase 1 features) and v0.12.1 (src/ directory fix)

**Fix**: Add comprehensive changelog entries:

```markdown
### v0.12.1 (2026-03-06)

**🐛 Bugfix Release**

- **FIX**: Include `src/` directory in npm package (Phase 1 modules were missing)
- **FIX**: Package.json `files` array now includes `src/` for heartbeat, cli, and onboarding modules

### v0.12.0 (2026-03-06)

**🎉 Phase 1: Zero-Friction Adoption Framework**

- **NEW**: Smart auto-capture with 4 privacy tiers (off/conservative/smart/aggressive)
- **NEW**: Privacy blocklist for sensitive data (passwords, SSN, credit cards, API keys)
- **NEW**: Daily memory stats in heartbeat (morning 9 AM, evening 8 PM)
- **NEW**: CLI stats command with text/JSON output (`memoryrelay:stats`)
- **NEW**: First-run onboarding wizard with welcome memory
- **NEW**: Three gateway methods: `memoryrelay:heartbeat`, `memoryrelay:stats`, `memoryrelay:onboarding`
- **NEW**: Auto-capture default changed from `false` to `smart` tier
- **NEW**: Modular architecture with `src/` directory (heartbeat, cli, onboarding modules)
- **CHANGE**: `autoCapture` config accepts boolean (backward compat) or object with tier system
- **DOCS**: PHASE1_CHANGELOG.md with complete implementation details
- **TESTS**: All existing tests pass, Phase 1 features validated

**Implementation**: 820 lines across 3 new modules
**Time**: 50 minutes (38% faster than 80-minute estimate)
**Backward Compatibility**: Fully compatible, no breaking changes
```

---

## Minor Issues

### 6. ⚠️ CLI Commands Section References Non-Existent Commands

**Location**: README.md line 405-421

**Problem**: Section documents 4 CLI commands that don't exist as shell commands:
- `memoryrelay-logs`
- `memoryrelay-health`  
- `memoryrelay-test`
- `memoryrelay-metrics`

These are gateway methods, not CLI commands. The correct invocation is:
```bash
openclaw gateway-call memoryrelay.logs
```

But the README shows:
```bash
memoryrelay-logs --limit=50
```

**Status**: Unclear if these are planned CLI wrappers or documentation error

**Recommendation**: Either:
1. Add actual CLI scripts to package.json `bin` field
2. Update docs to show correct gateway-call syntax
3. Add note: "Note: These are gateway methods. Invoke via `openclaw gateway-call memoryrelay.<method>`"

---

### 7. ⚠️ Tool Count Discrepancy

**Location**: README.md line 8, Feature list

**Current**:
```markdown
- **39 Tools** covering memories, entities, sessions, decisions, patterns, and projects
```

**Status**: Accurate as of v0.12.0, but no mention of 3 new gateway methods

**Recommendation**: Add clarity:
```markdown
- **39 Tools** + **6 Gateway Methods** covering memories, entities, sessions, decisions, patterns, projects, stats, and onboarding
```

---

## Recommendations

### High Priority (Must Fix for v0.12.2)

1. ✅ Update Node.js requirement from >=18 to >=20
2. ✅ Fix hardcoded version string in index.ts
3. ✅ Add Phase 1 feature documentation section
4. ✅ Update `autoCapture` config docs with tier system
5. ✅ Add v0.12.0 and v0.12.1 changelog entries

### Medium Priority (Should Fix Soon)

6. ⚠️ Clarify CLI commands vs gateway methods (decide on approach)
7. ⚠️ Update tool count to include gateway methods

### Low Priority (Nice to Have)

- Add troubleshooting section for Phase 1 features
- Add examples of auto-capture tier usage
- Document gateway method invocation patterns
- Add migration guide from v0.11.x to v0.12.x

---

## Testing Checklist

Before releasing v0.12.2:

- [ ] Verify Node 20+ requirement in CI
- [ ] Test plugin loads with correct version string
- [ ] Test all Phase 1 features (heartbeat, stats, onboarding)
- [ ] Test auto-capture tier migration (boolean → object)
- [ ] Verify npm package includes src/ directory
- [ ] Test gateway methods are callable
- [ ] Validate all links in README work
- [ ] Run full test suite
- [ ] Test installation from scratch

---

## Files to Update

1. `README.md` — 7 corrections + new Phase 1 section
2. `package.json` — engines.node: ">=20.0.0"
3. `index.ts` — line 3845 version string
4. Optional: `MIGRATION.md` — guide for v0.11.x → v0.12.x users

---

**Estimated Time to Fix**: 30-45 minutes  
**Severity**: Medium-High (functionality works, but docs misleading)  
**Impact**: User confusion, incorrect expectations, installation issues on Node 18
