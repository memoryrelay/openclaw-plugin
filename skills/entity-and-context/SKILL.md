---
name: entity-and-context
description: "Use when building relationship maps between people, organizations, projects, or concepts that appear across multiple memories, or when recalling information that benefits from entity connections rather than flat search."
---

# Entity and Context

Entities turn flat memory storage into a connected knowledge graph. Create entities for **named things that recur across multiple memories** and benefit from relationship tracking.

## Relevant Tools

| Tool | Signature | Purpose |
|------|-----------|---------|
| `entity_create` | `entity_create(name, type, metadata?)` | Create a new entity node |
| `entity_link` | `entity_link(entity_id, memory_id, relationship?)` | Connect an entity to a memory |
| `entity_list` | `entity_list(limit?, offset?)` | List entities with pagination |
| `entity_graph` | `entity_graph(entity_id, depth?, max_neighbors?)` | Explore an entity's neighborhood |
| `memory_context` | `memory_context(query, token_budget?)` | Enriched recall with entity connections (see `memory-workflow` skill) |

## Entity Types

| Type | Examples |
|------|----------|
| `person` | Team members, stakeholders, external contacts |
| `place` | Data centers, offices, deployment regions |
| `organization` | Companies, departments, vendors |
| `project` | Codebases, initiatives, products |
| `concept` | Architecture patterns, business domains, protocols |
| `other` | Anything that doesn't fit the above |

## When to Create Entities

Create an entity when a named thing:
- Appears in **2+ memories** (not one-off mentions)
- Has relationships worth tracking (owns, depends on, maintains)
- Would benefit from graph traversal during recall

## Linking Workflow

1. **Create the entity** — `entity_create("AuthService", "concept", { "domain": "security" })`
2. **Store related memories** — `memory_store(content, metadata)` as usual (see `memory-workflow` skill)
3. **Link them** — `entity_link(entity_id, memory_id, "mentioned_in")` to connect entity to each relevant memory
4. **Query with context** — `memory_context("authentication flow")` returns memories enriched with linked entity data
5. **Explore connections** — `entity_graph(entity_id, 2, 10)` to see related memories and co-linked entities up to 2 hops away

## memory_context vs memory_recall

| Use `memory_recall` | Use `memory_context` |
|---------------------|----------------------|
| Simple keyword/semantic search | Need entity relationships in results |
| No entities involved | Entities are linked to relevant memories |
| Quick lookup of isolated facts | Understanding how things connect |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Creating entities for one-off mentions | Only create entities for things referenced across multiple memories |
| Not linking entities to memories | An unlinked entity is invisible to `memory_context`; always link after creating |
| Using `memory_recall` when entities exist | Switch to `memory_context` for richer results that include entity connections |
| Creating duplicate entities | Call `entity_list()` first to check if the entity already exists |
| Linking everything to one entity | Keep links specific; an entity should connect only to directly relevant memories |
