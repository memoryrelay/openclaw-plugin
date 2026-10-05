import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { IcmApiError, MemoryRelayClient } from "../../src/client/memoryrelay-client.js";

const API = "https://api.test";
let calls: Array<{ url: string; init: RequestInit }>;
let responder: (url: string, init: RequestInit) => { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  responder = () => ({ status: 200, body: {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = responder(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const make = () => new MemoryRelayClient("mem_test", "iris", API);
const sent = (i = 0) => JSON.parse(String(calls[i].init.body));

describe("memory routes match the API", () => {
  test("search sends min_score and files the plugin's scoping under metadata_filter", async () => {
    responder = () => ({ status: 200, body: { data: [] } });
    await make().search("dark mode", 5, 0.65, { scope: "session", session_id: "agent:iris:1", tier: "hot" });
    expect(calls[0].url).toBe(`${API}/v1/memories/search`);
    const body = sent();
    expect(body.min_score).toBe(0.65);
    expect(body).not.toHaveProperty("threshold");
    expect(body.metadata_filter).toEqual({ scope: "session", session_id: "agent:iris:1" });
    expect(body.tier).toBe("hot");
    expect(body.agent_id).toBe("iris");
  });

  test("store keeps scope and session in metadata, never as top-level fields the API drops", async () => {
    responder = () => ({ status: 200, body: { id: "m1" } });
    await make().store("fact", { source: "test" }, { scope: "long-term", session_id: "s1", importance: 0.9 });
    const body = sent();
    expect(body.metadata).toEqual({ source: "test", scope: "long-term", session_id: "s1" });
    expect(body.importance).toBe(0.9);
    expect(body).not.toHaveProperty("scope");
    expect(body).not.toHaveProperty("session_id");
  });

  test("list caps limit at the API's 50", async () => {
    responder = () => ({ status: 200, body: { data: [] } });
    await make().list(100);
    expect(calls[0].url).toContain("limit=50");
  });

  test("the V2 context build lives at /v2/context/build", async () => {
    await make().buildContextV2("q", { maxMemories: 3 });
    expect(calls[0].url).toBe(`${API}/v2/context/build`);
    expect(sent().max_memories).toBe(3);
  });

  test("the removed resources are not on the client", () => {
    const c = make() as unknown as Record<string, unknown>;
    for (const gone of ["startSession", "getOrCreateSession", "recordDecision", "searchPatterns", "listProjects", "getProjectContext", "embed", "quota"]) {
      expect(c[gone]).toBeUndefined();
    }
  });
});

describe("ICM routes (/v2/icm)", () => {
  test("capabilities: 404 means no ICM, not an error", async () => {
    responder = () => ({ status: 404, body: { detail: "Not Found" } });
    expect(await make().icmCapabilities()).toEqual({ supported: false });
    expect(calls[0].url).toBe(`${API}/v2/icm/capabilities`);
  });

  test("context_for posts to builds:resolve and surfaces no_binding as IcmApiError", async () => {
    responder = () => ({ status: 404, body: { code: "no_binding", detail: "No binding matches this repo and step" } });
    const err = await make().icmContextFor({ repo: "memoryrelay/api", step: "fix", budget: 6000 }).catch((e) => e);
    expect(err).toBeInstanceOf(IcmApiError);
    expect(err.code).toBe("no_binding");
    expect(err.status).toBe(404);
    expect(calls[0].url).toBe(`${API}/v2/icm/context/builds:resolve`);
    expect(sent()).toEqual({ repo: "memoryrelay/api", step: "fix", budget: 6000 });
  });

  test("paths and headers of the run and draft calls", async () => {
    const c = make();
    await c.icmRoot("fix");
    await c.icmBuildContext("ws-1", { target: { kind: "repository", alias: "api", route: "fix" } });
    await c.icmPutArtifact("ws-1", "run-1", "stages/01/output/draft.md", "x", 3);
    await c.icmPutArtifact("ws-1", "run-1", "stages/01/output/draft.md", "x");
    await c.icmCreateRun("ws-1", { name: "r", channel: "live" }, "idem-1");
    await c.icmImportDraft("ws-1", { files: [] }, 2);
    await c.icmAddObservation("ws-1", "rc-1", { event_id: "e", kind: "read", method: "self_report", payload: {}, observed_at: "t" });
    const urls = calls.map((x) => x.url.replace(API, ""));
    expect(urls).toEqual([
      "/v2/icm/root?step=fix",
      "/v2/icm/workspaces/ws-1/context/builds",
      "/v2/icm/workspaces/ws-1/runs/run-1/artifacts/stages/01/output/draft.md",
      "/v2/icm/workspaces/ws-1/runs/run-1/artifacts/stages/01/output/draft.md",
      "/v2/icm/workspaces/ws-1/runs",
      "/v2/icm/workspaces/ws-1/draft/imports",
      "/v2/icm/workspaces/ws-1/receipts/rc-1/observations",
    ]);
    const headers = (i: number) => calls[i].init.headers as Record<string, string>;
    expect(headers(2)["If-Match"]).toBe('"3"');
    expect(headers(3)["If-None-Match"]).toBe("*");
    expect(headers(4)["Idempotency-Key"]).toBe("idem-1");
    expect(headers(5)["If-Match"]).toBe('"2"');
    expect(headers(0).Authorization).toBe("Bearer mem_test");
    expect(sent(1).target).toEqual({ kind: "repository", alias: "api", route: "fix" });
  });

  test("release export returns the zip bytes and raises IcmApiError when refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.includes("/releases/r-1/")
        ? new Response(new Uint8Array([0x50, 0x4b, 5, 6]), { status: 200, headers: { "Content-Type": "application/zip" } })
        : new Response(JSON.stringify({ detail: "No such release" }), { status: 404 });
    }));
    const bytes = await make().icmExportRelease("ws-1", "r-1");
    expect(Array.from(bytes)).toEqual([0x50, 0x4b, 5, 6]);
    expect(calls[0].url).toBe(`${API}/v2/icm/workspaces/ws-1/releases/r-1/export`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer mem_test");
    await expect(make().icmExportRelease("ws-1", "r-2")).rejects.toBeInstanceOf(IcmApiError);
  });

  test("artifact paths refuse traversal", async () => {
    await expect(make().icmGetArtifact("ws", "run", "../etc/passwd")).rejects.toThrow(/relative path/);
  });
});
