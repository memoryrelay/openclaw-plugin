---
verified_at: 2026-10-14
verified_commit: a9cb4d0f2f69bc260e7797c622e4dda7c55bd2b7
---

# Conventions — how code is written here

- **Pinned context first, memory as evidence.** The pinned-context hook never substitutes recall for a missing binding, and a blocked build pins nothing (`src/hooks/before-agent-start.ts:45`, `buildIcmContextBlock`; its tests in `tests/hooks/before-agent-start.test.ts`). The shipped skills say the same to the end user's agent (`skills/icm-context/SKILL.md`).
- **Recall and capture are pipelines of discrete stages**, each a pure function `(input, ctx)` returning `continue` with data or `skip` (`src/pipelines/runner.ts:3-12`, result types `src/pipelines/types.ts:186-201`). A new behaviour is a new stage with its own unit test, not a branch inside an existing one.
- **One immutable context per invocation**: `buildRequestContext` freezes it (`src/context/request-context.ts:15`); the OpenClaw session key is the session id (the API keeps no sessions).
- **Agent isolation** is `src/context/namespace-router.ts`: `isolateAgents` and the subagent policies `inherit`, `isolate`, `skip` (`src/context/namespace-router.ts:3-9`).
- **Config resolution**: the plugin config wins, then environment (`MEMORYRELAY_API_KEY`, `MEMORYRELAY_AGENT_ID`, `MEMORYRELAY_API_URL`, `MEMORYRELAY_ICM_REPO`, `MEMORYRELAY_ICM_STEP`), then defaults (`index.ts:313-391`). The options are the manifest's `configSchema` (`openclaw.plugin.json:178`); the README's configuration reference describes them for users.
- **Calls to the API** go through `MemoryRelayClient`: bearer token, 30 s timeout, 3 retries with exponential backoff on network errors and 5xx (`src/client/memoryrelay-client.ts:16-18`, `src/client/memoryrelay-client.ts:232`). Shapes the API enforces are in [api-alignment.md](api-alignment.md).
- **SDK types** come from `openclaw/plugin-sdk/core` as `import type` (`index.ts:21`); the bare `openclaw/plugin-sdk` subpath is gone.
- **Secrets never leave unredacted**: capture and the MEMORY.md mirror redact before sending (`src/memory/memory-md-sync.ts:59`, `src/hooks/privacy.ts`); a new path that sends user text reuses them.
- **Pull requests**: Conventional Commit subjects (`feat`, `fix`, `feat!` for a breaking change, `ci`, `chore`); a change users see carries its version in the title and its `CHANGELOG.md` entry (Keep a Changelog, `CHANGELOG.md:1-8`); see [release.md](release.md). Every pull request is reviewed and merged by a person.
