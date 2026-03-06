# Changelog Entry for v0.12.4

## [0.12.4] - 2026-03-06

### Fixed
- **Version Display**: Fixed hardcoded version strings causing inconsistent version display
  - `openclaw.plugin.json`: version 0.11.4 → 0.12.4, description "v0.11.5" → "v0.12.4"
  - `index.ts`: header comment version updated to 0.12.4
  - Plugin info now correctly shows v0.12.4 across all outputs
  
### Technical Details

**Issue**: OpenClaw `plugins info` was showing multiple conflicting versions:
- Description: "MemoryRelay v0.11.5"
- Version: 0.11.4  
- Recorded version: 0.12.1
- Log output: v0.12.2

**Root Cause**: `openclaw.plugin.json` had hardcoded old version strings that weren't updated during releases.

**Fix**: Synchronized all version references to 0.12.4.

**No Functional Changes**: This is a metadata-only release.
