# 01_reproduce — reproduce the reported defect

One job: turn the report into a vitest test that fails on demand, for the reason reported.

## Inputs
- Working (this run): the report — an issue (`gh issue view <n> --comments`), a red CI run's failed job log, a gateway log line from OpenClaw, or an API answer the plugin mishandles.
- Reference (every run): `.github/icm/_shared/architecture.md`
- Reference (every run): `.github/icm/_shared/build-and-test.md`
- Reference (every run): `.github/icm/_shared/gotchas.md`
- Reference (only when the report involves an API route, a tool name or a payload): `.github/icm/_shared/api-alignment.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/release.md`.

## Process
1. Restate the report as observed versus expected, and where it surfaced: a tool call (which tool, which group), a hook (pinned context, recall, capture), the memory corpora, the MEMORY.md mirror, the local cache, or install and load in OpenClaw (which OpenClaw version).
2. If OpenClaw itself changed (a new host release), compare with the host traps in [gotchas.md](../../../_shared/gotchas.md) first: register, `contracts.tools`, hook names, the memory slot.
3. If the API answered 404 or 422, check the route and payload against [api-alignment.md](../../../_shared/api-alignment.md) and the API's schema before assuming the plugin is wrong; an API change is route `api-drift`.
4. Find the code path with [architecture.md](../../../_shared/architecture.md) and name the suspected cause as `path:line`.
5. Write the failing test beside its neighbours (`tests/` mirrors `src/`), mocking the SDK and stubbing `fetch` as they do. It calls the stage, tool, hook or client method, never a copy of its logic.
6. Run it with `npx vitest run <file>` and keep the failing output. If it passes, the reproduction or the report is wrong: say which, and stop.

## Outputs
- reproduction.md → output/ — the restated report and its surface; the OpenClaw and plugin versions; suspected cause (`path:line`); the test file and command; the failing output; what the test does not cover (a live gateway, the real API).

## Human check
A person runs the test, or reads its output, and confirms it fails for the reported reason and not a neighbouring one.
