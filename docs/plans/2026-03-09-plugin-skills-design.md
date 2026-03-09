# MemoryRelay Plugin Skills Design

## Purpose

Create 8 specialized skills for the openclaw-plugin repo to guide both AI agents using the plugin's tools and developers contributing to the codebase.

## Skills Inventory

### Agent-Facing Skills

| Skill | Type | Purpose |
|-------|------|---------|
| `memory-workflow` | Technique | Proper workflow order (project -> session -> store/recall), categories, tags, deduplication, auto-capture tiers |
| `decision-tracking` | Technique | When to use decision tools vs plain memories, checking conflicts, superseding old decisions |
| `pattern-management` | Technique | Search before creating, proper pattern structure, adopting across projects |
| `project-orchestration` | Technique | Project registration as first step, relationships, dependency graphs, impact analysis |
| `entity-and-context` | Technique | Entity creation, linking to memories, building knowledge graphs |

### Developer-Facing Skills

| Skill | Type | Purpose |
|-------|------|---------|
| `codebase-navigation` | Reference | Monolithic index.ts structure, tool registration pattern, module map |
| `testing-memoryrelay` | Technique | Vitest patterns, mocking API client, testing tools/hooks/gateway methods |
| `release-process` | Technique | Versioning, changelog format, audit branches, CI/CD workflows |

## Directory Structure

```
skills/
  memory-workflow/SKILL.md
  decision-tracking/SKILL.md
  pattern-management/SKILL.md
  project-orchestration/SKILL.md
  entity-and-context/SKILL.md
  codebase-navigation/SKILL.md
  testing-memoryrelay/SKILL.md
  release-process/SKILL.md
```

## Skill Details

### memory-workflow

**Problem:** Agents jump to memory_store/memory_recall without context setup. Memories end up unscoped, uncategorized, duplicated.

**Content:**
- Workflow order: project_register -> session_start -> store/recall within context
- Deduplication: when to use deduplicate=true vs manual checking
- Category taxonomy guidance
- Tags best practices (consistent naming, searchability)
- Auto-capture tiers: off -> conservative -> smart -> aggressive
- Privacy blocklist awareness
- memory_promote for upgrading temporary memories

### decision-tracking

**Problem:** Agents don't record decisions, or use plain memories. Old decisions aren't superseded, causing contradictions.

**Content:**
- decision_record vs memory_store (decisions = choices with rationale + alternatives)
- decision_check before choices that might conflict
- decision_supersede when replacing decisions
- Project-scoping decisions

### pattern-management

**Problem:** Agents create duplicate patterns or don't use patterns at all.

**Content:**
- pattern_search before creating new patterns
- pattern_create with proper structure (problem, solution, context, examples)
- pattern_adopt for tracking usage across projects
- pattern_suggest for recommending patterns

### project-orchestration

**Problem:** Agents work without project context, missing dependency insights.

**Content:**
- project_register as first step
- project_add_relationship for linking projects
- project_dependencies / project_dependents
- project_impact before breaking changes
- project_shared_patterns for consistency
- project_context for full overview

### entity-and-context

**Problem:** Agents store flat memories without linking people, systems, concepts.

**Content:**
- entity_create for people, systems, services, concepts
- entity_link to connect entities to memories
- entity_graph for relationship visualization
- memory_context for enriched recall
- When entities add value vs plain memories

### codebase-navigation

**Problem:** New contributors face 140KB monolithic index.ts with no map.

**Content:**
- File map: index.ts sections (types -> config -> client -> tools -> hooks -> gateway)
- Tool registration pattern: isToolEnabled() -> api.registerTool() with factory
- Tool groups map
- Supporting modules: src/debug-logger, src/status-reporter, src/heartbeat/, src/onboarding/, src/cli/
- Configuration fallback chain
- Key types and interfaces

### testing-memoryrelay

**Problem:** Contributors don't know how to test tools hitting external API or lifecycle hooks.

**Content:**
- Test files: index.test.ts, src/*.test.ts
- Test runner: Vitest
- Mocking MemoryRelayClient
- Testing tools: input validation, response formatting, error cases
- Testing hooks: before_agent_start, agent_end
- Testing gateway methods
- Running tests: npm test

### release-process

**Problem:** Contributors don't know versioning convention, changelog format, or release flow.

**Content:**
- Semantic versioning rules
- CHANGELOG.md format with dates and categories
- Audit branch pattern: docs/pre-release-audit-v{version}
- CI/CD workflows: ci.yml, ci-cd.yml, publish.yml
- Version bump locations: package.json, openclaw.plugin.json, index.ts header
- Git commit conventions
