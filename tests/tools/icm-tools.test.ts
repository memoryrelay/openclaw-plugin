import { describe, expect, test, vi } from "vitest";
import { ICM_TOOLS, ICM_TOOL_NAMES, callIcmTool, icmErrorResult, registerIcmTools } from "../../src/tools/icm-tools.js";
import { IcmApiError } from "../../src/client/memoryrelay-client.js";

const WS = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

describe("ICM tool catalogue", () => {
  test("the 22 names @memoryrelay/mcp-server and /mcp serve, no duplicates", () => {
    expect(ICM_TOOL_NAMES).toEqual([
      "icm_capabilities", "icm_workspace_list", "icm_root", "icm_release_get", "icm_route_list",
      "icm_context_build", "icm_resolve", "icm_context_for", "icm_receipt_get", "icm_source_scan",
      "icm_score", "icm_maintenance", "icm_pull", "icm_run_start", "icm_stage_context",
      "icm_stage_write", "icm_stage_submit", "icm_run_status", "icm_report_reads",
      "icm_draft_get", "icm_draft_write", "icm_draft_propose",
    ]);
    expect(new Set(ICM_TOOL_NAMES).size).toBe(22);
    for (const t of ICM_TOOLS) {
      expect(t.description.startsWith("ICM:")).toBe(true);
      expect((t.parameters as { type: string }).type).toBe("object");
    }
  });

  test("context build accepts the repository target", () => {
    const build = ICM_TOOLS.find((t) => t.name === "icm_context_build")!;
    const kind = (build.parameters as any).properties.target.properties.kind.enum as string[];
    expect(kind).toContain("repository");
  });
});

describe("callIcmTool", () => {
  test("validates ids before calling the server", async () => {
    const client = { icmGetRelease: vi.fn() } as any;
    await expect(callIcmTool(client, "icm_release_get", { workspace_id: "nope", release_id: "x" })).rejects.toThrow(/workspace_id/);
    expect(client.icmGetRelease).not.toHaveBeenCalled();
  });

  test("icm_stage_context starts a pending stage, then builds it", async () => {
    const run = { run_id: RUN, release_id: "r".repeat(64), stages: [{ id: "draft", recorded_state: "pending", attempt: 1, status: "pending", outputs: ["out.md"] }] };
    const client = {
      icmGetRun: vi.fn(async () => run),
      icmTransition: vi.fn(async () => ({ ...run, stages: [{ ...run.stages[0], recorded_state: "running" }] })),
      icmBuildContext: vi.fn(async () => ({ receipt_id: "rc", disposition: "ready" })),
    } as any;
    const out = await callIcmTool(client, "icm_stage_context", { workspace_id: WS, run_id: RUN, stage: "draft" }, "https://app.test");
    expect(client.icmTransition).toHaveBeenCalledWith(WS, RUN, "draft", { action: "start", expected_attempt: 1 });
    expect(client.icmBuildContext).toHaveBeenCalledWith(WS, expect.objectContaining({ target: { kind: "stage", id: "draft", run_id: RUN } }));
    expect(out.started).toBe(true);
    expect(out.review_url).toBe(`https://app.test/dashboard/w/${WS}/runs?run=${RUN}&stage=draft`);
    expect(String(out.next)).toContain("icm_stage_submit");
  });

  test("icm_draft_propose on a service workspace sends nothing and points at the review page", async () => {
    const client = { icmGetWorkspace: vi.fn(async () => ({ authority_mode: "service" })), icmProposeDraft: vi.fn() } as any;
    const out = await callIcmTool(client, "icm_draft_propose", { workspace_id: WS, expected_digest: "a".repeat(64) }, "https://app.test");
    expect(out.proposed).toBe(false);
    expect(client.icmProposeDraft).not.toHaveBeenCalled();
    expect(out.review_url).toBe(`https://app.test/dashboard/w/${WS}/versions`);
  });

  test("icm_draft_write hashes each file and refuses traversal", async () => {
    const client = { icmImportDraft: vi.fn(async () => ({ ok: true })) } as any;
    await callIcmTool(client, "icm_draft_write", { workspace_id: WS, files: [{ path: "routes/fix.md", content: "hi" }], expected_revision: 4 });
    const [, body, rev] = client.icmImportDraft.mock.calls[0];
    expect(rev).toBe(4);
    expect(body.files[0]).toMatchObject({ path: "routes/fix.md", content: "hi" });
    expect(body.files[0].sha256).toHaveLength(64);
    expect(body.client.name).toBe("@memoryrelay/plugin-memoryrelay-ai");
    await expect(callIcmTool(client, "icm_draft_write", { workspace_id: WS, files: [{ path: "../x", content: "" }] })).rejects.toThrow(/segments|relative/);
  });

  test("icm_report_reads dedups paths and self-reports", async () => {
    const client = { icmAddObservation: vi.fn(async () => ({ recorded: true })) } as any;
    await callIcmTool(client, "icm_report_reads", { workspace_id: WS, receipt_id: RUN, paths: ["b.md", "a.md", "b.md"] });
    const [, , body] = client.icmAddObservation.mock.calls[0];
    expect(body.payload.paths).toEqual(["a.md", "b.md"]);
    expect(body.method).toBe("self_report");
  });
});

describe("registerIcmTools", () => {
  function fakeApi() {
    const tools: Record<string, any> = {};
    return {
      api: { registerTool: (factory: any, opts: { name: string }) => { tools[opts.name] = factory({}); } } as any,
      tools,
    };
  }

  test("registers the 22 tools and answers icm_unsupported against a server without ICM", async () => {
    const { api, tools } = fakeApi();
    const client = { icmCapabilities: vi.fn(async () => ({ supported: false })), icmListWorkspaces: vi.fn() } as any;
    registerIcmTools(api, {} as any, client, () => true);
    expect(Object.keys(tools)).toHaveLength(22);
    const result = await tools.icm_workspace_list.execute("id", {});
    expect(result.details.error).toBe("icm_unsupported");
    expect(client.icmListWorkspaces).not.toHaveBeenCalled();
  });

  test("honours the tool filter and turns a no_binding refusal into advice", async () => {
    const { api, tools } = fakeApi();
    const client = {
      icmCapabilities: vi.fn(async () => ({ supported: true })),
      icmContextFor: vi.fn(async () => { throw new IcmApiError(404, "no_binding", "No binding matches"); }),
    } as any;
    registerIcmTools(api, {} as any, client, (name) => name === "icm_context_for");
    expect(Object.keys(tools)).toEqual(["icm_context_for"]);
    const result = await tools.icm_context_for.execute("id", { repo: "memoryrelay/api", step: "fix" });
    expect(result.details.error).toBe("no_binding");
    expect(result.details.message).toContain("not a substitute");
  });

  test("icmErrorResult never leaks a stack", () => {
    const r = icmErrorResult(new Error("bad input"));
    expect(r.details).toEqual({ error: "invalid_request", message: "bad input" });
  });
});
