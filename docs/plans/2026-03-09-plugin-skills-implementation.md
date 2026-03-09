# MemoryRelay Plugin Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create 8 specialized skills (SKILL.md files) for the openclaw-plugin repo — 5 agent-facing and 3 developer-facing.

**Architecture:** Each skill is a standalone `skills/<name>/SKILL.md` file with YAML frontmatter (name + description). OpenClaw auto-discovers skills from the `skills/` directory. No code registration needed.

**Tech Stack:** Markdown with YAML frontmatter. OpenClaw skill format (see `node_modules/openclaw/skills/github/SKILL.md` for reference).

**Reference:** Design doc at `docs/plans/2026-03-09-plugin-skills-design.md`

---

### Task 1: Create skills directory structure

**Files:**
- Create: `skills/memory-workflow/SKILL.md` (empty placeholder)
- Create: `skills/decision-tracking/SKILL.md` (empty placeholder)
- Create: `skills/pattern-management/SKILL.md` (empty placeholder)
- Create: `skills/project-orchestration/SKILL.md` (empty placeholder)
- Create: `skills/entity-and-context/SKILL.md` (empty placeholder)
- Create: `skills/codebase-navigation/SKILL.md` (empty placeholder)
- Create: `skills/testing-memoryrelay/SKILL.md` (empty placeholder)
- Create: `skills/release-process/SKILL.md` (empty placeholder)

**Step 1: Create all skill directories**

```bash
mkdir -p skills/{memory-workflow,decision-tracking,pattern-management,project-orchestration,entity-and-context,codebase-navigation,testing-memoryrelay,release-process}
```

**Step 2: Verify structure**

```bash
find skills -type d | sort
```

Expected:
```
skills
skills/codebase-navigation
skills/decision-tracking
skills/entity-and-context
skills/memory-workflow
skills/pattern-management
skills/project-orchestration
skills/release-process
skills/testing-memoryrelay
```

**Step 3: Commit**

```bash
git add skills/
git commit -m "chore: scaffold skills directory structure for 8 plugin skills"
```

---

### Task 2: Write memory-workflow skill

**Files:**
- Create: `skills/memory-workflow/SKILL.md`

**Step 1: Write the skill**

The skill must cover:
- **Frontmatter:** name `memory-workflow`, description starting with "Use when..."
- **Workflow order:** project_register → session_start → store/recall within context
- **Tool reference:** All 9 memory tools (memory_store, memory_recall, memory_forget, memory_list, memory_get, memory_update, memory_batch_store, memory_context, memory_promote)
- **Deduplication:** When to use `deduplicate=true` parameter
- **Categories and tags:** Best practices for consistent metadata
- **Auto-capture tiers:** off → conservative → smart → aggressive (from `normalizeAutoCaptureConfig` in index.ts)
- **Privacy blocklist:** Passwords, SSNs, credit cards, API keys are filtered
- **memory_promote:** For upgrading temporary memories to long-term

Key workflow from `index.ts:3803-3878` (the `before_agent_start` hook):
1. Load context: `project_context(project)`
2. Start session: `session_start(title, project)`
3. Check decisions: `decision_check(query, project)`
4. Find patterns: `pattern_search(query)`
5. Store findings: `memory_store(content, metadata)`
6. End session: `session_end(session_id, summary)`

**Common mistakes to address:**
- Storing without a session (memories not linked to work context)
- Skipping deduplication (duplicate memories clutter search)
- Using memory_store for decisions (should use decision_record)
- Not using categories/tags (memories become unsearchable)
- Storing sensitive data (blocklist exists but agents should be aware)

**Step 2: Review the skill for completeness**

Read back the file and verify:
- Frontmatter is valid YAML with only `name` and `description`
- Description starts with "Use when..." and doesn't summarize workflow
- All 9 memory tools are referenced
- Workflow order matches what's in `index.ts:3803-3878`
- Under 500 words

**Step 3: Commit**

```bash
git add skills/memory-workflow/SKILL.md
git commit -m "feat: add memory-workflow skill for proper memory tool usage"
```

---

### Task 3: Write decision-tracking skill

**Files:**
- Create: `skills/decision-tracking/SKILL.md`

**Step 1: Write the skill**

The skill must cover:
- **Frontmatter:** name `decision-tracking`, description starting with "Use when..."
- **When to use decisions vs memories:** Decisions = choices with rationale + alternatives considered. Memories = facts, findings, information.
- **Tool reference:** All 4 decision tools:
  - `decision_record(title, rationale, project)` — record a new decision
  - `decision_list(project)` — list existing decisions
  - `decision_supersede(old_id, new_title, new_rationale)` — replace outdated decisions
  - `decision_check(query, project)` — check for conflicts before choosing
- **Workflow:** Always `decision_check` before making architectural choices. Record with rationale. Supersede (don't just add new) when decisions change.
- **Project scoping:** Decisions should be scoped to the relevant project via `defaultProject` config or explicit project parameter

**Common mistakes:**
- Recording decisions as plain memories (loses rationale/alternatives structure)
- Not checking for conflicts before deciding
- Adding new decisions instead of superseding old ones (causes contradictions)
- Not scoping decisions to a project

**Step 2: Review and verify**

**Step 3: Commit**

```bash
git add skills/decision-tracking/SKILL.md
git commit -m "feat: add decision-tracking skill for architectural decision management"
```

---

### Task 4: Write pattern-management skill

**Files:**
- Create: `skills/pattern-management/SKILL.md`

**Step 1: Write the skill**

The skill must cover:
- **Frontmatter:** name `pattern-management`, description starting with "Use when..."
- **Tool reference:** All 4 pattern tools:
  - `pattern_create(title, description)` — create a reusable pattern
  - `pattern_search(query)` — find existing patterns before creating new ones
  - `pattern_adopt(pattern_id, project)` — track which projects use which patterns
  - `pattern_suggest(project)` — get pattern recommendations for a project
- **Search-first workflow:** Always `pattern_search` before `pattern_create` to avoid duplicates
- **Pattern structure:** Problem, solution, context, examples
- **Cross-project consistency:** Use `pattern_adopt` and `pattern_suggest` for shared conventions

**Common mistakes:**
- Creating without searching first (duplicates)
- Vague pattern descriptions (unhelpful for future search)
- Not adopting patterns to projects (no tracking)
- Creating patterns that are too specific (not reusable)

**Step 2: Review and verify**

**Step 3: Commit**

```bash
git add skills/pattern-management/SKILL.md
git commit -m "feat: add pattern-management skill for reusable pattern workflows"
```

---

### Task 5: Write project-orchestration skill

**Files:**
- Create: `skills/project-orchestration/SKILL.md`

**Step 1: Write the skill**

The skill must cover:
- **Frontmatter:** name `project-orchestration`, description starting with "Use when..."
- **Tool reference:** All 10 project tools:
  - `project_register(slug, name, description, stack)` — register a new project
  - `project_list()` — list registered projects
  - `project_info(slug)` — get project details
  - `project_add_relationship(from, to, type)` — link related projects
  - `project_dependencies(slug)` — what this project depends on
  - `project_dependents(slug)` — what depends on this project
  - `project_related(slug)` — all related projects
  - `project_impact(slug)` — impact analysis before breaking changes
  - `project_shared_patterns(slug)` — patterns shared across related projects
  - `project_context(slug)` — full project overview (hot-tier memories, active decisions, adopted patterns)
- **First-time setup:** `project_list()` → `project_register()` if not found
- **`defaultProject` config:** When set, project parameter is auto-applied
- **Impact analysis:** Always run `project_impact` before breaking changes
- **Context loading:** `project_context` as the starting point for any project work

**Common mistakes:**
- Working without project context (missing dependencies, decisions, patterns)
- Registering duplicate projects (check `project_list` first)
- Not using relationships (isolated project silos)
- Making breaking changes without impact analysis

**Step 2: Review and verify**

**Step 3: Commit**

```bash
git add skills/project-orchestration/SKILL.md
git commit -m "feat: add project-orchestration skill for project management workflows"
```

---

### Task 6: Write entity-and-context skill

**Files:**
- Create: `skills/entity-and-context/SKILL.md`

**Step 1: Write the skill**

The skill must cover:
- **Frontmatter:** name `entity-and-context`, description starting with "Use when..."
- **Tool reference:** All 4 entity tools + memory_context:
  - `entity_create(name, type, description)` — create entities (people, systems, services, concepts)
  - `entity_link(entity_id, memory_id)` — connect entities to memories
  - `entity_list(type?)` — list entities, optionally filtered by type
  - `entity_graph(entity_id)` — visualize entity relationships
  - `memory_context(query)` — enriched recall that includes entity connections
- **Entity types:** People, systems, services, concepts, teams, repositories
- **When to create entities:** Named things that appear in multiple memories and benefit from relationship tracking
- **Linking workflow:** Create entity → store memories → link them → use memory_context for enriched recall

**Common mistakes:**
- Creating entities for one-off mentions (not worth the overhead)
- Not linking entities to memories (orphaned entities)
- Using memory_recall when memory_context would give richer results
- Creating duplicate entities (check entity_list first)

**Step 2: Review and verify**

**Step 3: Commit**

```bash
git add skills/entity-and-context/SKILL.md
git commit -m "feat: add entity-and-context skill for knowledge graph workflows"
```

---

### Task 7: Write codebase-navigation skill

**Files:**
- Create: `skills/codebase-navigation/SKILL.md`

**Step 1: Write the skill**

This is a Reference-type skill. It must cover:
- **Frontmatter:** name `codebase-navigation`, description starting with "Use when..."
- **File map of index.ts** (the 140KB monolithic file):
  - Lines 1-14: Header comments & version
  - Lines 16-37: Imports (openclaw SDK, heartbeat, cli, onboarding modules)
  - Lines 38-47: Constants (API URL, timeout, retries)
  - Lines 48-121: DebugLogger class (inlined)
  - Lines 122-350~: StatusReporter class (inlined)
  - Lines 350-1460~: Types, interfaces, MemoryRelayClient class
  - Lines 1460-1570: Plugin entry, config, TOOL_GROUPS, isToolEnabled()
  - Lines 1570-3780~: 39 tool registrations (each follows the pattern below)
  - Lines 3785-3908: `before_agent_start` hook (workflow + auto-recall)
  - Lines 3910-4000~: `agent_end` hook (auto-capture)
  - Lines 4000+: Gateway methods, CLI registration, onboarding

- **Tool registration pattern:**
  ```typescript
  if (isToolEnabled("tool_name")) {
    api.registerTool((ctx) => ({
      name: "tool_name",
      description: "...",
      parameters: { /* JSON schema */ },
      execute: async (_id, args) => { /* impl */ }
    }), { name: "tool_name" });
  }
  ```

- **TOOL_GROUPS map** (from index.ts:1526-1543):
  - memory (9), entity (4), agent (3), session (4), decision (4), pattern (4), project (10), health (1)

- **Supporting modules:**
  - `src/debug-logger.ts` — DebugLogger class (also inlined in index.ts)
  - `src/status-reporter.ts` — StatusReporter class (also inlined in index.ts)
  - `src/heartbeat/daily-stats.ts` — Morning/evening memory summaries
  - `src/onboarding/first-run.ts` — First-run onboarding wizard
  - `src/cli/stats-command.ts` — CLI stats command handler

- **Configuration fallback chain:** Plugin config → env vars (MEMORYRELAY_API_KEY, MEMORYRELAY_AGENT_ID, MEMORYRELAY_API_URL) → defaults

- **Key types:** Memory, SearchResult, Stats, LogEntry, DebugLoggerConfig, ConnectionStatus, ToolStatus

**Step 2: Review and verify**

**Step 3: Commit**

```bash
git add skills/codebase-navigation/SKILL.md
git commit -m "feat: add codebase-navigation skill for contributor onboarding"
```

---

### Task 8: Write testing-memoryrelay skill

**Files:**
- Create: `skills/testing-memoryrelay/SKILL.md`

**Step 1: Write the skill**

The skill must cover:
- **Frontmatter:** name `testing-memoryrelay`, description starting with "Use when..."
- **Test runner:** Vitest (`npm test`, `vitest run`, `vitest --watch`)
- **Test files:**
  - `index.test.ts` — Main integration tests (tools, hooks, gateway methods)
  - `src/debug-logger.test.ts` — DebugLogger unit tests
  - `src/status-reporter.test.ts` — StatusReporter unit tests
- **Mock pattern** (from index.test.ts):
  ```typescript
  import { describe, test, expect, beforeEach, vi } from "vitest";

  class MockMemoryRelayClient {
    private memories: Memory[] = [];
    private nextId = 1;

    async store(content, metadata?) { /* in-memory storage */ }
    async search(query, limit?, threshold?) { /* keyword matching */ }
    async list(limit?, offset?) { /* slice from array */ }
    async get(id) { /* find by id */ }
    async delete(id) { /* remove from array */ }
    async health() { return { status: "healthy" }; }
    async stats() { return { total_memories: this.memories.length }; }
  }
  ```
- **What to test for each tool:**
  - Input validation (required params, types)
  - Successful API call and response formatting
  - Error handling (API failures, timeouts)
  - Tool-specific logic (deduplication, session injection, etc.)
- **Testing hooks:**
  - `before_agent_start`: Verify workflow injection, auto-recall with mocked search
  - `agent_end`: Verify auto-capture filtering, blocklist, tier logic
- **Testing gateway methods:** Verify response format, error handling
- **Commands:**
  - `npm test` — run all tests once
  - `npm run test:watch` — watch mode
  - `npm run test:coverage` — with coverage report

**Step 2: Review and verify**

**Step 3: Commit**

```bash
git add skills/testing-memoryrelay/SKILL.md
git commit -m "feat: add testing-memoryrelay skill for contributor test guidance"
```

---

### Task 9: Write release-process skill

**Files:**
- Create: `skills/release-process/SKILL.md`

**Step 1: Write the skill**

The skill must cover:
- **Frontmatter:** name `release-process`, description starting with "Use when..."
- **Semantic versioning rules for this project:**
  - Patch (0.x.Y): Bug fixes, version string updates, doc fixes
  - Minor (0.X.0): New tools, new features, new config options
  - Major (X.0.0): Breaking API changes (not used yet, still 0.x)
- **Version bump locations** (all 3 must match):
  1. `package.json` → `"version": "X.Y.Z"`
  2. `openclaw.plugin.json` → `"version": "X.Y.Z"` and description string
  3. `index.ts` → Header comment `Version: X.Y.Z`
- **CHANGELOG.md format** (Keep a Changelog):
  ```markdown
  ## [X.Y.Z] - YYYY-MM-DD

  ### Added
  - **Feature Name**: Description

  ### Changed
  - Description of change

  ### Fixed
  - **Bug Name**: Description
  ```
  Plus comparison link at bottom: `[X.Y.Z]: https://github.com/memoryrelay/openclaw-plugin/compare/vPREV...vX.Y.Z`
- **Audit branch pattern:** `docs/pre-release-audit-v{version}` for documentation review before release
- **CI/CD workflows:**
  - `.github/workflows/ci.yml` — Tests on push/PR to main (Node 20.x + 22.x matrix)
  - `.github/workflows/ci-cd.yml` — Full CI/CD pipeline
  - `.github/workflows/publish.yml` — Manual NPM publish with version verification
- **Publish command:** `npm publish --provenance --access public` (requires NPM_TOKEN secret)
- **Git commit conventions** (from recent history):
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation changes
  - `chore:` for maintenance tasks
- **Release checklist:**
  1. Update version in all 3 locations
  2. Update CHANGELOG.md with new version entry
  3. Run tests: `npm test`
  4. Create audit branch if needed
  5. Merge to main
  6. Trigger publish workflow

**Step 2: Review and verify**

**Step 3: Commit**

```bash
git add skills/release-process/SKILL.md
git commit -m "feat: add release-process skill for contributor release guidance"
```

---

### Task 10: Update package.json to include skills in published files

**Files:**
- Modify: `package.json:46-52` (the `files` array)

**Step 1: Add skills/ to the files array**

In `package.json`, add `"skills/"` to the `files` array so skills are included when the package is published to NPM:

```json
"files": [
  "index.ts",
  "openclaw.plugin.json",
  "README.md",
  "LICENSE",
  "src/",
  "skills/"
]
```

**Step 2: Verify**

```bash
npm pack --dry-run 2>&1 | grep skills
```

Expected: skill files should appear in the pack output.

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include skills/ directory in published package files"
```

---

### Task 11: Final review and integration commit

**Step 1: Verify all 8 skills exist**

```bash
find skills -name "SKILL.md" | sort | wc -l
```

Expected: `8`

**Step 2: Verify all frontmatter is valid**

For each SKILL.md, check that:
- Has `---` delimiters
- Has `name:` field (letters, numbers, hyphens only)
- Has `description:` field starting with "Use when"
- Total frontmatter under 1024 characters

**Step 3: Read through each skill for consistency**

Verify:
- Tool names match exactly what's in `index.ts` TOOL_GROUPS
- Workflow order matches `before_agent_start` hook logic
- No contradictions between skills
- Cross-references between skills are accurate (e.g., memory-workflow references decision-tracking)

**Step 4: Run tests to make sure nothing is broken**

```bash
npm test
```

Expected: All existing tests pass (skills are just markdown files, shouldn't affect tests).

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "docs: finalize all 8 plugin skills for v0.12.11"
```
