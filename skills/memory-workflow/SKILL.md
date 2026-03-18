---
name: memory-workflow
description: "Use when starting a new conversation or task that needs persistent memory, storing or retrieving information across sessions, or working within a project that uses MemoryRelay."
---

# Memory Workflow

Follow this order every time. Skipping steps causes orphaned memories.

## Startup Sequence

| Step | Call | Purpose |
|------|------|---------|
| 1 | `project_context(project)` | Load hot-tier memories, active decisions, adopted patterns |
| 2 | `session_start(title, project)` | Begin tracking work (returns `session_id`) |
| 3 | `decision_check(query, project)` | Check existing decisions before architectural choices (see `decision-tracking` skill) |
| 4 | `pattern_search(query)` | Find established conventions (see `pattern-management` skill) |

## During Work

| Action | Tool | Notes |
|--------|------|-------|
| Save info | `memory_store(content, metadata)` | Always set `deduplicate=true` |
| Search | `memory_recall(query, limit?, threshold?)` | Semantic search across memories |
| Delete | `memory_forget(id_or_query)` | By ID or fuzzy search |
| Browse | `memory_list(limit, offset)` | Chronological listing |
| Read one | `memory_get(id)` | Fetch by exact ID |
| Edit | `memory_update(id, content)` | Correct or expand existing |
| Bulk save | `memory_batch_store(memories[])` | Efficient for multiple items |
| Build prompt | `memory_context(query, token_budget)` | Token-aware context window (see `entity-and-context` skill) |
| Upgrade | `memory_promote(id, importance, tier)` | Move temporary to long-term |

**For architectural choices**, use `decision_record` instead of `memory_store` — see the `decision-tracking` skill.

**For reusable conventions**, use `pattern_create` instead of `memory_store` — see the `pattern-management` skill.

## Ending a Session

Call `session_end(session_id, summary)` with a meaningful summary. This becomes the historical record.

## Deduplication

Always pass `deduplicate=true` on `memory_store` and `memory_batch_store`. The default threshold is 0.9 similarity. Skipping this clutters search results with near-duplicates.

## Metadata Best Practices

Always include `category` and `tags` in metadata:

```
metadata: { "category": "technical", "tags": "auth, api", "source": "code-review" }
```

Categories: `technical`, `preference`, `credential`, `decision`. Consistent metadata makes filtering reliable.

## Memory Tiers and Promotion

| Tier | Retention | Use for |
|------|-----------|---------|
| `hot` | Always loaded by `project_context` | Critical project facts |
| `warm` | Retrieved by search | General knowledge |
| `cold` | Archived, low priority | Historical notes |

Use `memory_promote(id, importance, tier)` to upgrade a memory. Set `importance` near 1.0 for critical items.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Storing without a session | Always call `session_start` first |
| Skipping `deduplicate=true` | Set it on every `memory_store` call |
| Using `memory_store` for decisions | Use `decision_record` instead (see `decision-tracking` skill) |
| Using `memory_store` for conventions | Use `pattern_create` instead (see `pattern-management` skill) |
| No category/tags in metadata | Always include both for searchability |
| Storing API keys or passwords | Blocklist auto-rejects these; use a secrets manager |
