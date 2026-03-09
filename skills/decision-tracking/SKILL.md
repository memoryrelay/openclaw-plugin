---
name: decision-tracking
description: "Use when making architectural choices, evaluating alternatives, revisiting past decisions, or needing to check whether a decision already exists before committing to a direction."
---

# Decision Tracking

Decisions are **choices with rationale and alternatives considered**. Plain facts, findings, or information are memories — use `memory_store` for those.

## Decision Tools

| Tool | Signature | Purpose |
|------|-----------|---------|
| `decision_record` | `decision_record(title, rationale, project)` | Record a new decision with reasoning |
| `decision_list` | `decision_list(project)` | List all decisions for a project |
| `decision_supersede` | `decision_supersede(old_id, new_title, new_rationale)` | Replace an outdated decision |
| `decision_check` | `decision_check(query, project)` | Check for conflicting decisions before choosing |

## Workflow

1. **Check first** — Always call `decision_check(query, project)` before making an architectural choice. This surfaces existing decisions that may conflict or already cover the topic.
2. **Record with rationale** — Use `decision_record(title, rationale, project)`. The rationale should include why this option was chosen and what alternatives were rejected.
3. **Supersede, don't duplicate** — When a decision changes, call `decision_supersede(old_id, new_title, new_rationale)`. This preserves history while marking the old decision as replaced.
4. **Review periodically** — Use `decision_list(project)` to audit active decisions during planning or refactoring.

## Project Scoping

Decisions must be scoped to the relevant project:

- Set `defaultProject` in plugin config to avoid passing `project` on every call.
- Pass `project` explicitly when working across multiple projects.
- Unscoped decisions pollute search results and create false conflicts.

## Decisions vs Memories

| Store as Decision | Store as Memory |
|-------------------|-----------------|
| "Use PostgreSQL over MongoDB for user data" | "PostgreSQL supports JSONB columns" |
| "Adopt ESM modules, drop CommonJS" | "Node 20 supports ESM natively" |
| "API versioning via URL path, not headers" | "Team prefers REST over GraphQL" |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Recording decisions with `memory_store` | Use `decision_record` — decisions need rationale tracking and conflict detection |
| Making choices without `decision_check` | Always check first; conflicting decisions cause inconsistent architecture |
| Adding a new decision when one already exists | Use `decision_supersede` to replace the old decision, preserving history |
| Omitting the `project` parameter | Scope every decision to a project via parameter or `defaultProject` config |
| Storing facts as decisions | Only choices with rationale belong in decisions; use `memory_store` for information |
