# 02_implement — build what the spec says

One job: implement every surface the approved spec names, and nothing it does not.

## Inputs
- Working (this run): `.github/icm/02-feature/stages/01_spec/output/spec.md`
- Reference (every run): `.github/icm/_shared/architecture.md`
- Reference (every run): `.github/icm/_shared/conventions.md`
- Reference (only when the capability adds or changes a tool, a route or a payload): `.github/icm/_shared/api-alignment.md`
- Reference (only when the capability touches hooks, the memory slot or the corpora): `.github/icm/_shared/gotchas.md`
- Reference (only when the capability touches the build, the manifest or the install scripts): `.github/icm/_shared/build-and-test.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/documents.md`.

## Process
1. Client methods first (`src/client/memoryrelay-client.ts`), then tools (`src/tools/`, and `TOOL_GROUPS` in `index.ts`), then hooks or pipeline stages, then config (`openclaw.plugin.json` `configSchema` and the resolution in `index.ts`).
2. Add every new tool name to `openclaw.plugin.json` `contracts.tools`; `tests/manifest-contracts.test.ts` fails otherwise.
3. Keep `register` synchronous; relative imports carry `.js`; SDK types are `import type` from `openclaw/plugin-sdk/core`.
4. Update the shipped skill that teaches the tool (`skills/*/SKILL.md`) when a tool is added, renamed or removed.
5. If a surface turns out to need something the spec did not name, stop and return to stage 01.

## Outputs
- implementation.md → output/ — each file changed and which spec line it serves; any deviation from the spec and why; what was left for stage 03.

## Human check
A person reads the diff against the spec: every surface named is built, nothing else is, and the manifest lists every new tool.
