---
name: release-process
description: "Use when bumping the plugin version, preparing a release, updating the CHANGELOG, creating a pre-release audit branch, or triggering the NPM publish workflow."
---

# Release Process

## Semantic Versioning (0.x series)

| Bump | When | Example |
|------|------|---------|
| **Patch** (0.x.Y) | Bug fixes, version string updates, doc fixes | 0.12.10 → 0.12.11 |
| **Minor** (0.X.0) | New tools, new features, new config options | 0.12.11 → 0.13.0 |
| **Major** (X.0.0) | Breaking API changes (not used yet) | 0.13.0 → 1.0.0 |

## Version Bump Locations

All three files must match the same version string:

| File | Field |
|------|-------|
| `package.json` | `"version": "X.Y.Z"` |
| `openclaw.plugin.json` | `"version": "X.Y.Z"` and description string |
| `index.ts` | Header comment `Version: X.Y.Z` |

## CHANGELOG.md Format

Follows [Keep a Changelog](https://keepachangelog.com/). Each release entry:

```markdown
## [X.Y.Z] - YYYY-MM-DD
### Added
- **Feature Name**: Description
### Changed
- Description
### Fixed
- **Bug Name**: Description
```

Add a comparison link at the bottom of the file:

```
[X.Y.Z]: https://github.com/memoryrelay/openclaw-plugin/compare/vPREV...vX.Y.Z
```

## Git Commit Conventions

| Prefix | Use |
|--------|-----|
| `feat:` | New features or tools |
| `fix:` | Bug fixes |
| `docs:` | Documentation changes |
| `chore:` | Maintenance, deps, cleanup |

## CI/CD Workflows

| File | Trigger | Purpose |
|------|---------|---------|
| `.github/workflows/ci.yml` | Push/PR to main | Tests on Node 20.x + 22.x matrix |
| `.github/workflows/ci-cd.yml` | Push/PR | Full CI/CD pipeline |
| `.github/workflows/publish.yml` | Manual dispatch | NPM publish with version verification |

The publish workflow runs `npm publish --provenance --access public` and requires the `NPM_TOKEN` secret.

## Pre-Release Audit Branch

For doc review before release, create an audit branch:

```
docs/pre-release-audit-v{version}
```

Example: `docs/pre-release-audit-v0.12.11`. Merge to main once the audit is complete.

## Release Checklist

1. Update version in all 3 locations (`package.json`, `openclaw.plugin.json`, `index.ts`)
2. Update `CHANGELOG.md` with new entry and comparison link
3. Run `npm test` -- all tests must pass
4. Create audit branch (`docs/pre-release-audit-v{version}`) if doc changes are needed
5. Merge audit branch to main
6. Trigger the `publish.yml` workflow manually from GitHub Actions
7. Verify the published package on NPM
