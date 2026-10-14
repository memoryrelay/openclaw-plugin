# 01_spec — say what will exist and what it calls

One job: a spec a reviewer can approve line by line before any code.

## Inputs
- Working (this run): the request — an issue, a message, a fix run's `reproduction.md` (route `fix-to-feature`), or the open items of the API alignment (route `api-drift`).
- Reference (every run): `.github/icm/_shared/architecture.md`
- Reference (every run): `.github/icm/_shared/api-alignment.md`
- Reference (every run): `.github/icm/_shared/conventions.md`
- Reference (only when the capability depends on OpenClaw host behaviour (hooks, memory slot, corpora)): `.github/icm/_shared/gotchas.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/release.md`.

## Process
1. Restate the request as what the end user's agent or the operator will see.
2. For route `api-drift`, start from the open list in [api-alignment.md](../../../_shared/api-alignment.md) and the review it links; take one item or a named set, and re-check each against memoryrelay/api `main` (the remote tool list, the OpenAPI schema) before writing it down: the API moves.
3. List the surfaces: each tool (group, name, arguments, result) with its source of truth in memoryrelay/api; each API route it calls (method, path, payload); each config option (manifest `configSchema`, environment variable, default); each hook it changes; the manifest's `contracts.tools`; the shipped skills that must mention it.
4. Say what the plugin does when the API or the host lacks the capability (an older server, an older OpenClaw); the `icm_unsupported` guard is the pattern.
5. Say whether the change is breaking (a removed tool or option, a changed default): that decides `feat!` and the version.
6. Write what is **not** built, and why.

## Outputs
- spec.md → output/ — behaviour; surfaces (tools, routes, options, hooks, manifest, skills); fallback; breaking or not; not built; the tests that will prove each line.

## Human check
A person approves the spec, in particular the tool names and routes against memoryrelay/api and whether it is breaking.
