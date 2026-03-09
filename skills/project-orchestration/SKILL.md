---
name: project-orchestration
description: "Use when registering a new project, loading project context before starting work, checking cross-project dependencies or impact before breaking changes, or managing relationships between projects."
---

# Project Orchestration

Projects are the top-level organizer. Every session, memory, decision, and pattern ties back to a project slug.

## Project Tools

| Tool | Signature | Purpose |
|------|-----------|---------|
| `project_register` | `project_register(slug, name, description, stack)` | Register a new project |
| `project_list` | `project_list()` | List all registered projects |
| `project_info` | `project_info(slug)` | Get project details |
| `project_add_relationship` | `project_add_relationship(from, to, type)` | Link related projects |
| `project_dependencies` | `project_dependencies(slug)` | What this project depends on |
| `project_dependents` | `project_dependents(slug)` | What depends on this project |
| `project_related` | `project_related(slug)` | All related projects (any direction) |
| `project_impact` | `project_impact(slug)` | Impact analysis before breaking changes |
| `project_shared_patterns` | `project_shared_patterns(slug)` | Patterns shared across related projects |
| `project_context` | `project_context(slug)` | Full overview: hot-tier memories, active decisions, adopted patterns |

## First-Time Setup

1. Call `project_list()` to see existing projects.
2. If your project is not listed, call `project_register(slug, name, description, stack)`.
3. If it exists, proceed — do not register duplicates.

## defaultProject Config

When `defaultProject` is set in plugin configuration, the project slug is **auto-applied** to sessions, decisions, and memories. You do not need to pass the project parameter explicitly on each call — it is injected automatically.

## Context Loading

Always call `project_context(slug)` as the **first step** when beginning work on a project. It returns:

- **Hot-tier memories** — critical facts always surfaced
- **Active decisions** — current architectural choices
- **Adopted patterns** — conventions in use

This replaces manual searching. Start here, then drill into specifics with other tools.

## Impact Analysis

Before making **any breaking change**, call `project_impact(slug)`. It checks:

- Downstream dependents that will be affected
- Shared patterns that may need updating
- Active decisions that may conflict

Never skip this step. Breaking a dependency without checking impact creates cascading failures.

## Managing Relationships

Use `project_add_relationship(from, to, type)` to declare how projects relate. Relationship types include dependencies, shared ownership, and related context. Once linked:

- `project_dependencies(slug)` — upstream projects this one relies on
- `project_dependents(slug)` — downstream projects relying on this one
- `project_related(slug)` — all connections regardless of direction
- `project_shared_patterns(slug)` — patterns adopted by both this project and its related projects

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Working without project context | Always `project_context` first — it loads everything you need |
| Registering duplicate projects | Call `project_list` before `project_register`; check if slug exists |
| Not using relationships | Call `project_add_relationship` when projects share code, APIs, or conventions |
| Breaking changes without impact check | Always `project_impact` before modifying shared interfaces or dependencies |
| Passing project on every call when `defaultProject` is set | Unnecessary — the config injects it automatically |
