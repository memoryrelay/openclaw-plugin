---
verified_at: 2026-10-15
verified_commit: 889029f7ac3e335f3a462cf9671ed9efeb4ecd79
---

# API alignment — what this plugin must match in memoryrelay/api, and what does not match today

memoryrelay/api is the source of truth for what the API serves and what an MCP tool is called; this plugin follows it. Read this before a change to the client, a tool, a hook that calls the API, or a skill that names a tool.

## The rules

- **Tool names come from the API repository.** The remote MCP tool set is [`app/remote_mcp/tools.py`](https://github.com/memoryrelay/api/blob/main/app/remote_mcp/tools.py) in memoryrelay/api; the npm MCP server mirrors it in [`mcp/src/server.ts`](https://github.com/memoryrelay/api/blob/main/mcp/src/server.ts) and [`mcp/src/icm-agent.ts`](https://github.com/memoryrelay/api/blob/main/mcp/src/icm-agent.ts). The `icm` group here (`ICM_TOOLS`, `src/tools/icm-tools.ts:37`) takes the same names and arguments. Change a tool there first, then here. Read them at their source; never copy their list into this workspace.
- **A tool the plugin registers is declared in the manifest.** `openclaw.plugin.json` `contracts.tools` must equal the registered set; `tests/manifest-contracts.test.ts` fails otherwise.
- **The retired surface stays retired.** The API has no sessions, decisions, patterns, projects, `/v1/embed` or `/v1/quota` (removed in 0.25.0, `CHANGELOG.md:84`). Do not add a tool that calls them. `scope`, `session_id` and `namespace` are memory metadata, sent as `metadata_filter` (`src/client/memoryrelay-client.ts:409-424`).
- **Payload shapes the API enforces:** search sends `min_score` (`src/client/memoryrelay-client.ts:420`); `GET /v1/memories` caps `limit` at 50 (`src/client/memoryrelay-client.ts:432`); entity types are the API's enum (`src/tools/entity-tools.ts:31`); `agentId` is an agent **name**, resolved by the API (default from the host's agent name, `index.ts:314`).
- **Who checks the paths.** The API's `tests/test_client_contract.py` covers only its in-repo clients (`mcp/`, `sdk/python/`) and names this plugin as "checked by hand". Here, `tests/client/icm-client.test.ts` asserts the paths and payloads the client sends, with `fetch` stubbed: it proves what is sent, not that the API serves it. The API ignores unknown request fields, so a stale field fails silently, not with a 422.

## The 2026-10-04 alignment review, and where it stands

[Plugin and client alignment review](https://github.com/memoryrelay/api/blob/main/docs/plans/2026-10-04-plugin-alignment-review.md), section 1 "OpenClaw plugin" and "Recommendations", in memoryrelay/api. It reviewed this repository at `2297e13` (0.24.0): 18 of 32 routes removed, 23 of 42 tools answering 404, hooks and skills calling dead tools, four shape drifts, no ICM.

That section describes 0.24.0, not this commit. Pull request #143 (0.25.0, `CHANGELOG.md:84`) did the rebuild of Recommendation 2: the dead groups, hooks, skills and settings are gone, the `icm` group and pinned context are in, the four shape drifts and the `/v2/context/build` path are fixed. The ICM tool set matches again since 2026-10-15: `ICM_TOOLS` carries the same 24 tools as `app/remote_mcp/tools.py` and `mcp/`, with `icm_search` (`GET /v2/icm/search`, `src/client/memoryrelay-client.ts:774`) and `icm_report_outcome` (an `outcome` observation on the receipt) added with the npm server's names, arguments and validation. Checked on 2026-10-14: every method and path in `src/client/memoryrelay-client.ts` is served by the API's OpenAPI schema on memoryrelay/api `main` (`5bc343c`).

## Open: the input for a `02-feature` run (route `api-drift`)

1. **Own HTTP client.** Recommendation 2 ends with "consume the published `@memoryrelay/mcp-server` client module rather than carry its own HTTP client"; the plugin still carries `src/client/memoryrelay-client.ts`. Not decided; a spec names the trade-off.
2. **No contract test against the API's schema here.** Recommendation 5 asks for a scheduled job in each public repository that asserts every path the client calls exists in the API's OpenAPI schema. This repository's workflows (`ci.yml`, `ci-cd.yml`, `publish.yml`, `dependency-graph.yml`) have none.
3. **Docs that still describe the old API:** see "Known drift" in [documents.md](documents.md).
