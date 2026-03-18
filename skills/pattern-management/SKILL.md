---
name: pattern-management
description: "Use when establishing reusable conventions, looking up existing patterns before implementing a solution, adopting shared patterns across projects, or getting pattern recommendations for a project."
---

# Pattern Management

Patterns are **reusable solutions with problem context**. Plain implementation notes are memories — use `memory_store` for those (see `memory-workflow` skill).

## Pattern Tools

| Tool | Signature | Purpose |
|------|-----------|---------|
| `pattern_create` | `pattern_create(title, description, category?, example_code?, scope?, tags?, source_project?)` | Create a reusable pattern |
| `pattern_search` | `pattern_search(query, category?, project?, limit?, threshold?)` | Find existing patterns |
| `pattern_adopt` | `pattern_adopt(pattern_id, project)` | Track which projects use which patterns |
| `pattern_suggest` | `pattern_suggest(project, limit?)` | Get pattern recommendations for a project |

## Workflow

1. **Search first** — Always call `pattern_search(query)` before `pattern_create`. Duplicate patterns fragment conventions and confuse future lookups.
2. **Create with structure** — If no match exists, call `pattern_create(title, description, category, example_code)`. Include `example_code` for maximum usefulness. Set `scope` to `"global"` for cross-project or `"project"` for project-specific patterns.
3. **Adopt to projects** — Call `pattern_adopt(pattern_id, project)` so the pattern appears in `project_context` results and `pattern_suggest` recommendations (see `project-orchestration` skill).
4. **Review suggestions** — Use `pattern_suggest(project)` when starting work on a project to discover applicable conventions.

## Pattern Structure

Every `description` in `pattern_create` should include:

| Section | Content |
|---------|---------|
| **Problem** | What recurring issue this solves |
| **Solution** | The reusable approach or convention |
| **Context** | When to apply (and when not to) |
| **Examples** | Concrete usage showing the pattern in action |

```
pattern_create(
  "RFC 7807 Error Responses",
  "Problem: Inconsistent error responses across API endpoints.\nSolution: Return { error, code, details? } on all 4xx/5xx.\nContext: REST APIs with multiple consumers. Not needed for internal RPC.",
  "error-handling",
  '{ error: "Invalid email", code: "VALIDATION_ERROR", details: { field: "email" } }',
  "global",
  ["api", "rest", "validation"]
)
```

## Cross-Project Consistency

- `pattern_adopt(pattern_id, project)` links a pattern to a project. Multiple projects can adopt the same pattern.
- `pattern_suggest(project)` returns unadopted patterns that may be relevant based on project context.
- Adopted patterns load automatically via `project_context`, keeping teams aligned without manual lookups.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Creating without searching first | Always `pattern_search` before `pattern_create` — duplicates fragment conventions |
| Vague descriptions | Follow the Problem/Solution/Context/Examples structure; be specific and actionable |
| Omitting `example_code` | Always include a concrete code example — patterns without examples are hard to apply |
| Not adopting to projects | Call `pattern_adopt` after creating; unadopted patterns are invisible to `project_context` |
| Patterns too specific | Patterns should generalize across contexts; one-off solutions belong in memories or decisions |
