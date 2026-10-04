/**
 * ICM tools: pinned context workspaces (/v2/icm). Same 22 names, arguments and
 * behaviour as @memoryrelay/mcp-server and the remote endpoint (/mcp), so an
 * agent reads one description of ICM whichever client it holds.
 *
 * Nothing here approves, publishes or merges. Submitting a stage and proposing
 * a draft return the address where a person decides; the server refuses a key
 * that tries. Memory tools are evidence; a blocked build supplies nothing and
 * memory search is never a substitute for pinned context.
 */
import { createHash, randomUUID } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import { IcmApiError, type IcmBuildRequest, type IcmRun, type IcmRunStage, type MemoryRelayClient } from "../client/memoryrelay-client.js";

export const NPM_PACKAGE = "@memoryrelay/mcp-server";
export const DEFAULT_APP_URL = "https://app.memoryrelay.ai";
export const DRAFT_CLIENT = { name: "@memoryrelay/plugin-memoryrelay-ai" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELEASE_RE = /^[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const PATH_RE = /^[a-zA-Z0-9_./-]{1,240}$/;

const WS = { type: "string", description: "Workspace UUID" };
const RUN = { type: "string", description: "Run UUID" };
const RUNTIME = { type: "string", enum: ["claude_code", "codex_cli"] };
const BUDGET = { type: "number", description: "Estimated-token budget (500-200000)", minimum: 500, maximum: 200000 };

export interface IcmToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const ICM_TOOLS: IcmToolSpec[] = [
  {
    name: "icm_capabilities",
    description: "ICM: what this MemoryRelay server supports for pinned context workspaces (schemas, forms, runtimes, build targets, limits) and who this key is. Returns supported=false on a server without ICM.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "icm_workspace_list",
    description: "ICM: list the context workspaces this key can read, with your role in each.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "icm_root",
    description: "ICM: the root: one row per repository your workspaces include (workspace, alias, repository, the repository's route for `step` when it has one, and which bindings name it). A table to read, not a fallback: icm_context_for still answers no_binding when nothing is bound.",
    parameters: { type: "object", properties: { step: { type: "string", description: 'Workflow step, e.g. "implement"' } } },
  },
  {
    name: "icm_release_get",
    description: "ICM: get an immutable release: its manifest, pinned file listing (path, sha256, size) and walk report. The server verifies every byte before answering.",
    parameters: {
      type: "object",
      properties: { workspace_id: WS, release_id: { type: "string", description: "64-hex release ID", pattern: "^[0-9a-f]{64}$" } },
      required: ["workspace_id", "release_id"],
    },
  },
  {
    name: "icm_route_list",
    description: "ICM: the routes compiled from the workspace entry file's \"Route by what just happened\" table (the live version unless release_id is given). A route id is what icm_context_build {kind:\"route\"} takes.",
    parameters: {
      type: "object",
      properties: { workspace_id: WS, release_id: { type: "string", pattern: "^[0-9a-f]{64}$" } },
      required: ["workspace_id"],
    },
  },
  {
    name: "icm_context_build",
    description: "ICM: build the exact context for a target of a release: the entry file, the catalog chain to the target, the target's contract or card, then its declared inputs and required closure; optional files fill the remaining budget. A build that cannot fit its required context (or needs stale or restricted content) is BLOCKED (nothing supplied), never truncated. Every build records a receipt. Targets: entry, route, stage, record, notes, nodes, impact, repository (a repository the workspace includes: {kind:\"repository\", alias, route?}). Without release_id or channel the live version is used.",
    parameters: {
      type: "object",
      properties: {
        workspace_id: WS,
        target: {
          type: "object",
          description: 'What to build for: {kind:"entry"} | {kind:"route",id} | {kind:"stage",id,run_id?} | {kind:"record",id} | {kind:"notes",task,layers?} | {kind:"nodes",ids?|paths?,link_depth?} | {kind:"impact",object} | {kind:"repository",alias,route?,stage?}',
          properties: {
            kind: { type: "string", enum: ["entry", "route", "stage", "record", "notes", "nodes", "impact", "repository"] },
            id: { type: "string" },
            run_id: { type: "string" },
            task: { type: "string" },
            layers: { type: "array", items: { type: "string", enum: ["A", "B", "C"] } },
            ids: { type: "array", items: { type: "string" } },
            paths: { type: "array", items: { type: "string" } },
            link_depth: { type: "number", enum: [0, 1] },
            object: { type: "string" },
            alias: { type: "string" },
            route: { type: "string" },
            stage: { type: "string" },
          },
          required: ["kind"],
        },
        stage: { type: "string", description: 'Older spelling of target {kind:"stage", id}' },
        project_id: { type: "string", description: "Project ID in the release (default: the first)" },
        runtime: RUNTIME,
        token_budget: BUDGET,
        release_id: { type: "string", description: "Exact release (64 hex)", pattern: "^[0-9a-f]{64}$" },
        channel: { type: "string", description: 'Channel to resolve, e.g. "live"' },
      },
      required: ["workspace_id"],
    },
  },
  {
    name: "icm_resolve",
    description: "ICM: which workspace and route this repo / workflow step is bound to (bindings are set by people in MemoryRelay). Returns {match: null} when nothing is bound: then there is no pinned context, and memory search is not a substitute.",
    parameters: {
      type: "object",
      properties: { repo: { type: "string", description: 'Repository, e.g. "memoryrelay/api"' }, step: { type: "string", description: 'Workflow step, e.g. "implement"' } },
    },
  },
  {
    name: "icm_context_for",
    description: "ICM: resolve this repo / step to its bound route and build that route's context in one call. Fails with no_binding when nothing is bound (never falls back). Start here before any memory search.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: 'Repository, e.g. "memoryrelay/api"' },
        step: { type: "string", description: 'Workflow step, e.g. "implement"' },
        budget: BUDGET,
        runtime: RUNTIME,
      },
    },
  },
  {
    name: "icm_receipt_get",
    description: "ICM: read a context receipt: what was supplied (exact hashes, origins and hops for a repository build) and, separately, what was observed (materialized, reads, citations, outcome).",
    parameters: {
      type: "object",
      properties: { workspace_id: WS, receipt_id: { type: "string", description: "Receipt UUID" } },
      required: ["workspace_id", "receipt_id"],
    },
  },
  {
    name: "icm_source_scan",
    description: "ICM: what a Git workspace's repository holds at its branch: existing ICM workspaces, the instruction files agents already read and which agent reads each, the entry a workspace would route from, documents and template suggestions. Names only; never a file's content.",
    parameters: { type: "object", properties: { workspace_id: WS }, required: ["workspace_id"] },
  },
  {
    name: "icm_score",
    description: "ICM: the scorecard of a workspace: before (every instruction file an agent reads whole on the repository, in tokens) against after (the live version's entry, routes, stages with human checks, dated facts), plus facts past review and drift. Read-only.",
    parameters: { type: "object", properties: { workspace_id: WS }, required: ["workspace_id"] },
  },
  {
    name: "icm_maintenance",
    description: "ICM: the facts of a workspace's live version that need re-verifying (past their review date, or their evidence changed since), including those of the repositories it includes. Each item names the pinned files, the evidence, why, and the steps that close it; the answer says whether this key may propose the fix. Next: read the evidence at the current commit, fix the file, icm_draft_write, icm_draft_propose.",
    parameters: { type: "object", properties: { workspace_id: WS }, required: ["workspace_id"] },
  },
  {
    name: "icm_pull",
    description: "ICM: how to have a workspace as a plain folder (an agent walks it with no service). Returns the live version, the export route and the one command that downloads it: `npx -y @memoryrelay/mcp-server pull <slug>`. Pulling never writes back.",
    parameters: {
      type: "object",
      properties: { workspace: { type: "string", description: "Workspace UUID or slug" }, route: { type: "string", description: "Optional route id to start from" } },
      required: ["workspace"],
    },
  },
  {
    name: "icm_run_start",
    description: "ICM: start a run pinned to one release (the live version unless release_id or channel is given). Needs icm:run and contributor on the workspace. Pass the same idempotency_key to retry safely. Next: icm_stage_context for the first stage.",
    parameters: {
      type: "object",
      properties: {
        workspace_id: WS,
        name: { type: "string", description: 'Run name, e.g. "Week 40 report"' },
        release_id: { type: "string", pattern: "^[0-9a-f]{64}$" },
        channel: { type: "string" },
        pipeline: { type: "string", description: "Umbrella workspaces: the pipeline root" },
        idempotency_key: { type: "string", maxLength: 128 },
      },
      required: ["workspace_id", "name"],
    },
  },
  {
    name: "icm_stage_context",
    description: "ICM: begin (or resume) one stage of a run and get what it needs: the stage contract and its context package, plus the output paths to write. Starts the stage when it is pending or was sent back. Needs icm:run and icm:context. Next: icm_stage_write each output, then icm_stage_submit.",
    parameters: {
      type: "object",
      properties: { workspace_id: WS, run_id: RUN, stage: { type: "string", description: "Stage id (from the run's stages)" }, token_budget: BUDGET, runtime: RUNTIME },
      required: ["workspace_id", "run_id", "stage"],
    },
  },
  {
    name: "icm_stage_write",
    description: "ICM: write one stage output file into the run (plain text, a path from the stage's outputs). The first write needs no revision; to replace a file pass the expected_revision you last saw: an output a person edited is never overwritten blindly. Needs icm:run.",
    parameters: {
      type: "object",
      properties: { workspace_id: WS, run_id: RUN, path: { type: "string", description: "Output path, e.g. stages/01_x/output/draft.md" }, content: { type: "string" }, expected_revision: { type: "number", minimum: 1 } },
      required: ["workspace_id", "run_id", "path", "content"],
    },
  },
  {
    name: "icm_stage_submit",
    description: "ICM: hand a stage's outputs to a person for review. The agent cannot approve or send back: a person does that at review_url. The next stage can start only after that approval. Needs icm:run.",
    parameters: {
      type: "object",
      properties: { workspace_id: WS, run_id: RUN, stage: { type: "string" }, expected_attempt: { type: "number", minimum: 1 } },
      required: ["workspace_id", "run_id", "stage"],
    },
  },
  {
    name: "icm_run_status",
    description: "ICM: status of a human-gated run: per stage, the recorded state, attempt, output digest and whether an approval still matches the outputs. Read-only.",
    parameters: { type: "object", properties: { workspace_id: WS, run_id: RUN }, required: ["workspace_id", "run_id"] },
  },
  {
    name: "icm_report_reads",
    description: "ICM: report which supplied files you actually read (or materialized) for a context receipt, so the workspace's Activity shows what the agent used. Paths must be ones the build supplied. Needs icm:observe.",
    parameters: {
      type: "object",
      properties: {
        workspace_id: WS,
        receipt_id: { type: "string", description: "From the build (receipt_id)" },
        paths: { type: "array", items: { type: "string" }, minItems: 1 },
        kind: { type: "string", enum: ["read", "materialized"], default: "read" },
        event_id: { type: "string", maxLength: 128 },
      },
      required: ["workspace_id", "receipt_id", "paths"],
    },
  },
  {
    name: "icm_draft_get",
    description: "ICM: the workspace's draft: its changed files, the digest a proposal must name, and the pull request it was proposed as (Git workspaces). Also says whether the workspace is Git (changes become a pull request a person merges) or service (a person publishes the draft).",
    parameters: { type: "object", properties: { workspace_id: WS }, required: ["workspace_id"] },
  },
  {
    name: "icm_draft_write",
    description: "ICM: write one or more files into the workspace's draft (plain text, paths relative to the workspace). Nothing is published or pushed: a person decides. Pass expected_revision (the draft revision you last saw) to refuse a concurrent change. Needs icm:run and a key confined to the workspace.",
    parameters: {
      type: "object",
      properties: {
        workspace_id: WS,
        files: { type: "array", minItems: 1, maxItems: 500, items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
        expected_revision: { type: "number", minimum: 0 },
      },
      required: ["workspace_id", "files"],
    },
  },
  {
    name: "icm_draft_propose",
    description: "ICM: propose the draft for a person's decision. Git workspace: opens (or updates) a pull request a person merges in GitHub (allowed for an agent key only when a person turned on agent proposals). Service workspace: nothing is sent; returns review_url, where a person publishes. Needs icm:run.",
    parameters: {
      type: "object",
      properties: {
        workspace_id: WS,
        expected_digest: { type: "string", description: "The draft digest from icm_draft_get (what you are proposing)" },
        title: { type: "string", maxLength: 200 },
        body: { type: "string", maxLength: 4000 },
      },
      required: ["workspace_id", "expected_digest"],
    },
  },
];

export const ICM_TOOL_NAMES = ICM_TOOLS.map((t) => t.name);

type Args = Record<string, unknown>;

function need(args: Args, name: string, re: RegExp, what: string): string {
  const v = args[name];
  if (typeof v !== "string" || !re.test(v)) throw new Error(`Invalid ${name}: must be ${what}`);
  return v;
}

function maybe(args: Args, name: string, re: RegExp, what: string): string | undefined {
  return args[name] === undefined || args[name] === null ? undefined : need(args, name, re, what);
}

function text(args: Args, name: string, required = true): string | undefined {
  const v = args[name];
  if (v === undefined || v === null) {
    if (required) throw new Error(`${name} is required`);
    return undefined;
  }
  if (typeof v !== "string" || v.length === 0) throw new Error(`${name} must be a non-empty string`);
  return v;
}

function int(args: Args, name: string, min: number): number | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new Error(`${name} must be an integer >= ${min}`);
  return v;
}

function draftPath(path: unknown): string {
  if (typeof path !== "string" || !PATH_RE.test(path) || path.startsWith("/")) throw new Error("path must be a relative workspace path");
  if (path.split("/").some((p) => p === "" || p === "." || p === "..")) throw new Error("path must not contain empty, . or .. segments");
  return path;
}

export function versionsUrl(appUrl: string, workspaceId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/dashboard/w/${workspaceId}/versions`;
}

export function reviewUrl(appUrl: string, workspaceId: string, runId: string, stage?: string): string {
  const url = `${appUrl.replace(/\/+$/, "")}/dashboard/w/${workspaceId}/runs?run=${runId}`;
  return stage ? `${url}&stage=${encodeURIComponent(stage)}` : url;
}

function stageOf(run: IcmRun, id: string): IcmRunStage {
  const stage = run.stages.find((s) => s.id === id);
  if (!stage) throw new Error(`Stage "${id}" is not in this run (stages: ${run.stages.map((s) => s.id).join(", ")})`);
  return stage;
}

function summary(stage: IcmRunStage): Record<string, unknown> {
  const { id, status, recorded_state, attempt, outputs, human_check, last_note, artifacts } = stage;
  return { id, status, recorded_state, attempt, outputs, human_check, last_note, artifacts };
}

async function findWorkspace(client: MemoryRelayClient, ref: string): Promise<{ id: string; slug: string; name: string; role: string }> {
  const listed = (await client.icmListWorkspaces()) as { workspaces?: Array<{ id: string; slug: string; name: string; role: string }> };
  const ws = (listed.workspaces ?? []).find((w) => w.id === ref || w.slug === ref);
  if (!ws) throw new Error(`No workspace "${ref}" is visible to this key (by id or slug)`);
  return ws;
}

/** Run one ICM tool. Throws on bad arguments; IcmApiError on a server refusal. */
export async function callIcmTool(
  client: MemoryRelayClient,
  name: string,
  args: Args,
  appUrl: string = DEFAULT_APP_URL,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "icm_capabilities":
      return client.icmCapabilities();

    case "icm_workspace_list":
      return client.icmListWorkspaces();

    case "icm_root":
      return client.icmRoot(text(args, "step", false));

    case "icm_release_get":
      return client.icmGetRelease(need(args, "workspace_id", UUID_RE, "a UUID"), need(args, "release_id", RELEASE_RE, "a 64-hex release id"));

    case "icm_route_list": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      const rid = maybe(args, "release_id", RELEASE_RE, "a 64-hex release id");
      return { ...(await client.icmListRoutes(wid, rid)) };
    }

    case "icm_context_build": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      if (args.release_id !== undefined && args.channel !== undefined) throw new Error("Give at most one of release_id or channel");
      if ((args.target === undefined) === (args.stage === undefined)) throw new Error("Give exactly one of target or stage");
      return client.icmBuildContext(wid, {
        target: args.target as IcmBuildRequest["target"],
        stage: args.stage as string | undefined,
        project_id: args.project_id as string | undefined,
        runtime: args.runtime as string | undefined,
        token_budget: args.token_budget as number | undefined,
        release_id: args.release_id as string | undefined,
        channel: args.channel as string | undefined,
      });
    }

    case "icm_resolve":
      return client.icmResolve({ repo: text(args, "repo", false), step: text(args, "step", false) });

    case "icm_context_for":
      return client.icmContextFor({
        repo: text(args, "repo", false),
        step: text(args, "step", false),
        budget: int(args, "budget", 500),
        runtime: text(args, "runtime", false),
      });

    case "icm_receipt_get":
      return client.icmGetReceipt(need(args, "workspace_id", UUID_RE, "a UUID"), need(args, "receipt_id", UUID_RE, "a UUID"));

    case "icm_source_scan":
      return { ...(await client.icmSourceScan(need(args, "workspace_id", UUID_RE, "a UUID"))) };

    case "icm_score":
      return { ...(await client.icmScore(need(args, "workspace_id", UUID_RE, "a UUID"))) };

    case "icm_maintenance": {
      const body = await client.icmMaintenance(need(args, "workspace_id", UUID_RE, "a UUID"));
      const items = Array.isArray(body.items) ? body.items.length : 0;
      const next =
        items === 0
          ? "Every fact is current; nothing to do."
          : body.agent_proposals
            ? `${items} fact(s) to re-verify. Follow steps; propose with icm_draft_propose.`
            : `${items} fact(s) to re-verify. This source does not let agents open pull requests: tell a person what you found, or ask them to turn on agent proposals.`;
      return { ...body, next };
    }

    case "icm_pull": {
      const ref = text(args, "workspace")!;
      if (!UUID_RE.test(ref) && !SLUG_RE.test(ref)) throw new Error("workspace must be a UUID or a slug");
      const routeId = maybe(args, "route", SAFE_ID_RE, "a route id");
      const ws = await findWorkspace(client, ref);
      let releaseId: string;
      try {
        releaseId = (await client.icmGetChannel(ws.id, "live")).release_id;
      } catch (error) {
        if (error instanceof IcmApiError && error.status === 404) {
          throw new Error("no_live_version: this workspace has no live version yet; a person publishes one first", { cause: error });
        }
        throw error;
      }
      const routes = await client.icmListRoutes(ws.id, releaseId);
      const route = routeId ? routes.routes.find((r) => r.id === routeId) : undefined;
      if (routeId && !route) throw new Error(`Route "${routeId}" is not in the live version (routes: ${routes.routes.map((r) => r.id).join(", ")})`);
      const folder = `.icm/${ws.slug}`;
      const command = `npx -y ${NPM_PACKAGE} pull ${ws.slug}${routeId ? ` --route ${routeId}` : ""}`;
      return {
        workspace: { id: ws.id, slug: ws.slug, name: ws.name, role: ws.role },
        live_release_id: releaseId,
        export: { method: "GET", path: `/v2/icm/workspaces/${ws.id}/releases/${releaseId}/export`, format: "zip: every release file at its path plus manifest.json" },
        command,
        status_command: `npx -y ${NPM_PACKAGE} status --dir ${folder}`,
        folder,
        entry: routes.entry,
        route: route ?? null,
        next: [
          `Run \`${command}\` where the agent works (MEMORYRELAY_API_KEY set).`,
          `Open ${folder}/${routes.entry} and walk the files: the entry routes you to the stage; load only what the stage lists.`,
          "The folder is a reviewed version, read-only; re-run pull when status says live moved.",
        ],
      };
    }

    case "icm_run_start": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      const rid = maybe(args, "release_id", RELEASE_RE, "a 64-hex release id");
      const channel = text(args, "channel", false);
      if (rid && channel) throw new Error("Give at most one of release_id or channel");
      const key = text(args, "idempotency_key", false) ?? randomUUID();
      const run = await client.icmCreateRun(
        wid,
        { name: text(args, "name")!, ...(rid ? { release_id: rid } : { channel: channel ?? "live" }), ...(args.pipeline ? { pipeline: text(args, "pipeline")! } : {}) },
        key,
      );
      return { ...run, idempotency_key: key, review_url: reviewUrl(appUrl, wid, run.run_id), next: `Call icm_stage_context for the first stage (${run.stages[0]?.id ?? "see stages"}).` };
    }

    case "icm_stage_context": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      const rid = need(args, "run_id", UUID_RE, "a UUID");
      const stageId = need(args, "stage", SAFE_ID_RE, "a stage id");
      let run = await client.icmGetRun(wid, rid);
      let stage = stageOf(run, stageId);
      let started = false;
      if (stage.recorded_state === "pending" || stage.recorded_state === "rejected") {
        run = await client.icmTransition(wid, rid, stageId, { action: "start", expected_attempt: stage.attempt });
        stage = stageOf(run, stageId);
        started = true;
      }
      const budget = int(args, "token_budget", 1);
      const runtime = text(args, "runtime", false);
      const build = await client.icmBuildContext(wid, {
        target: { kind: "stage", id: stageId, run_id: rid },
        release_id: run.release_id,
        ...(budget !== undefined ? { token_budget: budget } : {}),
        ...(runtime ? { runtime } : {}),
      });
      const running = stage.recorded_state === "running";
      return {
        run_id: rid,
        release_id: run.release_id,
        started,
        stage: summary(stage),
        context: build,
        review_url: reviewUrl(appUrl, wid, rid, stageId),
        next: running
          ? `Do the stage's work from the package, write each output with icm_stage_write, report the files you read with icm_report_reads (receipt ${String(build.receipt_id)}), then icm_stage_submit.`
          : `This stage is ${stage.recorded_state}: it waits on a person, who reviews at review_url. Nothing to write until it is sent back.`,
      };
    }

    case "icm_stage_write": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      const rid = need(args, "run_id", UUID_RE, "a UUID");
      const path = text(args, "path")!;
      if (typeof args.content !== "string") throw new Error("content must be a string");
      const expected = int(args, "expected_revision", 1);
      try {
        return await client.icmPutArtifact(wid, rid, path, args.content, expected);
      } catch (error) {
        if (error instanceof IcmApiError && error.status === 409 && expected === undefined) {
          const current = await client.icmGetArtifact(wid, rid, path).catch(() => null);
          if (current) {
            throw new Error(`revision_conflict: this output already exists at revision ${current.revision}. Read it (a person may have edited it) and pass expected_revision to replace it.`, { cause: error });
          }
        }
        throw error;
      }
    }

    case "icm_stage_submit": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      const rid = need(args, "run_id", UUID_RE, "a UUID");
      const stageId = need(args, "stage", SAFE_ID_RE, "a stage id");
      let attempt = int(args, "expected_attempt", 1);
      if (attempt === undefined) attempt = stageOf(await client.icmGetRun(wid, rid), stageId).attempt;
      const run = await client.icmTransition(wid, rid, stageId, { action: "submit", expected_attempt: attempt });
      const url = reviewUrl(appUrl, wid, rid, stageId);
      return {
        run_id: rid,
        stage: summary(stageOf(run, stageId)),
        review_url: url,
        review: `Submitted. Waiting on a person: they read the outputs at ${url} and approve or send the stage back with a note. Check with icm_run_status; do not start the next stage until this one is approved.`,
      };
    }

    case "icm_run_status":
      return client.icmGetRun(need(args, "workspace_id", UUID_RE, "a UUID"), need(args, "run_id", UUID_RE, "a UUID"));

    case "icm_report_reads": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      const receipt = need(args, "receipt_id", UUID_RE, "a UUID");
      const paths = args.paths;
      if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === "string")) throw new Error("paths must be a non-empty list of strings");
      const kind = (args.kind as string | undefined) ?? "read";
      if (kind !== "read" && kind !== "materialized") throw new Error("kind must be read or materialized");
      return client.icmAddObservation(wid, receipt, {
        event_id: text(args, "event_id", false) ?? randomUUID(),
        kind,
        method: "self_report",
        payload: { paths: [...new Set(paths as string[])].sort() },
        observed_at: new Date().toISOString(),
      });
    }

    case "icm_draft_get": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      const workspace = await client.icmGetWorkspace(wid);
      const draft = await client.icmGetDraft(wid);
      const git = workspace.authority_mode === "git";
      return {
        ...draft,
        authority_mode: workspace.authority_mode,
        review_url: versionsUrl(appUrl, wid),
        next: git
          ? "Write files with icm_draft_write, then icm_draft_propose with this digest: it opens or updates a pull request; a person merges it in GitHub."
          : "Write files with icm_draft_write; a person reviews and publishes the draft at review_url (icm_draft_propose returns that address).",
      };
    }

    case "icm_draft_write": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      const files = args.files;
      if (!Array.isArray(files) || files.length === 0) throw new Error("files must be a non-empty list");
      const body = files.map((item: unknown) => {
        if (typeof item !== "object" || item === null) throw new Error("each file is {path, content}");
        const { path, content } = item as { path?: unknown; content?: unknown };
        if (typeof content !== "string") throw new Error("content must be a string");
        return { path: draftPath(path), content, sha256: createHash("sha256").update(content, "utf8").digest("hex") };
      });
      return client.icmImportDraft(wid, { client: DRAFT_CLIENT, origin: { kind: "mcp", id: "icm_draft_write" }, files: body, mode: "merge" }, int(args, "expected_revision", 0));
    }

    case "icm_draft_propose": {
      const wid = need(args, "workspace_id", UUID_RE, "a UUID");
      const digest = need(args, "expected_digest", RELEASE_RE, "the 64-hex draft digest");
      const title = text(args, "title", false);
      const note = text(args, "body", false);
      const workspace = await client.icmGetWorkspace(wid);
      const url = versionsUrl(appUrl, wid);
      if (workspace.authority_mode !== "git") {
        return { proposed: false, review_url: url, review: `This workspace publishes its drafts in MemoryRelay: a person with publisher reviews the draft at ${url} and publishes it. Nothing was sent.` };
      }
      const pull = await client.icmProposeDraft(wid, { expected_digest: digest, ...(title !== undefined ? { title } : {}), ...(note !== undefined ? { body: note } : {}) });
      return { proposed: true, ...pull, review_url: url, review: `Pull request #${String(pull.number)} is open at ${String(pull.url)}. A person reviews and merges it in GitHub; the merge publishes. Do not merge it yourself.` };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** A refusal the agent can act on, never a stack trace. */
export function icmErrorResult(error: unknown): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  const details: Record<string, unknown> =
    error instanceof IcmApiError
      ? { error: error.code, status: error.status, message: error.message }
      : { error: "invalid_request", message: error instanceof Error ? error.message : String(error) };
  if (error instanceof IcmApiError && error.status === 404 && error.code === "no_binding") {
    details.message = "No binding matches this repo and step. A person binds a route in MemoryRelay; until then there is no pinned context, and memory search is not a substitute.";
  }
  return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
}

export function registerIcmTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  isToolEnabled: (name: string) => boolean,
): void {
  const appUrl = process.env.MEMORYRELAY_APP_URL || DEFAULT_APP_URL;
  let supported: boolean | null = null;

  async function icmSupported(): Promise<boolean> {
    if (supported === null) supported = (await client.icmCapabilities()).supported;
    return supported;
  }

  for (const spec of ICM_TOOLS) {
    if (!isToolEnabled(spec.name)) continue;
    api.registerTool(
      (_ctx) => ({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        execute: async (_id: unknown, args: Args) => {
          try {
            if (spec.name === "icm_capabilities") {
              const caps = await client.icmCapabilities();
              supported = caps.supported;
              return { content: [{ type: "text", text: JSON.stringify(caps, null, 2) }], details: caps };
            }
            if (!(await icmSupported())) {
              const details = {
                supported: false,
                error: "icm_unsupported",
                message: "This MemoryRelay server does not offer ICM (/v2/icm). No context was built; do not substitute memory search for pinned ICM context.",
              };
              return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
            }
            const result = await callIcmTool(client, spec.name, args ?? {}, appUrl);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
          } catch (error) {
            return icmErrorResult(error);
          }
        },
      }),
      { name: spec.name },
    );
  }
  void config;
}
