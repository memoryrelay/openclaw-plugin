# Release v0.12.4 - Version Display Fix

**Release Date**: March 6, 2026  
**Type**: Metadata Fix  
**Priority**: Low (cosmetic only)

---

## 🐛 Bug Fixes

### Version Display Consistency

**Issue**: OpenClaw `plugins info` was showing multiple conflicting versions:
- Description: "MemoryRelay v0.11.5"
- Version field: 0.11.4
- Recorded version: 0.12.1  
- Log output: v0.12.2

**Root Cause**: `openclaw.plugin.json` contained hardcoded version strings that weren't updated during previous releases.

**Fix**: Synchronized all version references to 0.12.4:
- `openclaw.plugin.json` - version: "0.11.4" → "0.12.4"
- `openclaw.plugin.json` - description: "v0.11.5" → "v0.12.4"
- `index.ts` - header comment: "Version: 0.12.0" → "Version: 0.12.4"

**Impact**: Cosmetic only - no functional changes.

---

## 📦 Installation

### New Users

```bash
openclaw plugins install @memoryrelay/plugin-memoryrelay-ai
```

### Existing Users

```bash
sudo npm install -g @memoryrelay/plugin-memoryrelay-ai@latest
openclaw gateway restart
```

---

## ✅ Verification

Check that version is now consistent:

```bash
openclaw plugins info plugin-memoryrelay-ai
```

**Expected Output**:
```
MemoryRelay AI
id: plugin-memoryrelay-ai
MemoryRelay v0.12.4 - Long-term memory...

Status: loaded
Version: 0.12.4
```

And in gateway logs:
```
memory-memoryrelay: plugin v0.12.4 loaded (39 tools...)
```

---

## 📊 Changes Since v0.12.3

**Files Changed**: 2  
**Lines Changed**: 4 (metadata only)

**Modified Files**:
- `openclaw.plugin.json` - version and description updated
- `index.ts` - header comment version updated

---

## 🔗 Links

- **GitHub Release**: https://github.com/memoryrelay/openclaw-plugin/releases/tag/v0.12.4
- **NPM Package**: https://www.npmjs.com/package/@memoryrelay/plugin-memoryrelay-ai/v/0.12.4

---

**Full Changelog**: https://github.com/memoryrelay/openclaw-plugin/compare/v0.12.3...v0.12.4
