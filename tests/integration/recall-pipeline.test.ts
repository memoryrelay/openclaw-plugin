// tests/integration/recall-pipeline.test.ts
import { describe, test, expect, vi } from "vitest";
import { runPipeline } from "../../src/pipelines/runner.js";
import { recallPipeline } from "../../src/pipelines/recall/index.js";
import { buildRequestContext } from "../../src/context/request-context.js";
import type { PipelineContext, RecallInput, MemoryRelayClient, LocalCacheLike, SyncDaemonLike } from "../../src/pipelines/types.js";

function mockClient(longTermResults: any[] = [], sessionResults: any[] = []): MemoryRelayClient {
  return {
    search: vi.fn(async (_q, _l, _t, opts) => {
      if (opts?.scope === "long-term") return longTermResults;
      if (opts?.scope === "session") return sessionResults;
      return [];
    }),
    store: vi.fn(), list: vi.fn(), getOrCreateSession: vi.fn(), endSession: vi.fn(),
  };
}

describe("recall pipeline end-to-end", () => {
  test("produces formatted output with both scopes", async () => {
    const client = mockClient(
      [{ memory: { id: "m1", content: "User prefers dark mode", created_at: new Date().toISOString(), importance: 0.8 }, score: 0.85 }],
      [{ memory: { id: "m2", content: "Working on auth bug fix", created_at: new Date().toISOString() }, score: 0.9 }],
    );
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "What are my preferences?" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("<long-term-memories>");
    expect(result!.formatted).toContain("dark mode");
    expect(result!.formatted).toContain("<session-memories>");
    expect(result!.formatted).toContain("auth bug");
  });

  test("skips entirely for non-interactive trigger", async () => {
    const client = mockClient();
    const config = { autoRecall: true, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:cron:daily", trigger: "cron" }, prompt: "HEARTBEAT_OK" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).toBeNull();
    expect(client.search).not.toHaveBeenCalled();
  });

  test("routes subagent recall to parent with notice", async () => {
    const client = mockClient(
      [{ memory: { id: "m1", content: "Parent's preference", created_at: new Date().toISOString() }, score: 0.8 }],
      [],
    );
    const config = { autoRecall: true, agentId: "test", namespace: { subagentPolicy: "inherit" } };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:subagent:task-uuid" }, prompt: "What context do I have?" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("parent session");
    expect(result!.formatted).toContain("Parent's preference");
  });

  test("skips when no memories found", async () => {
    const client = mockClient([], []);
    const config = { autoRecall: true, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "Tell me about this project" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).toBeNull();
  });
});

// --- Local-first recall tests ---

function mockLocalCache(memories: any[] = [], syncState?: { lastPull: string | null }): LocalCacheLike {
  return {
    search: vi.fn((_query, opts) => {
      return memories.filter((m: any) => !opts?.scope || m.scope === opts.scope);
    }),
    getSyncState: vi.fn(() => ({
      lastPull: syncState?.lastPull ?? new Date().toISOString(),
      lastPush: null,
      cursor: null,
    })),
    count: vi.fn(() => memories.length),
  };
}

function mockSyncDaemon(): SyncDaemonLike & { pull: ReturnType<typeof vi.fn> } {
  return {
    pull: vi.fn(async () => ({ upserted: 0, deleted: 0 })),
  };
}

const localMemory = (id: string, content: string, scope: "long-term" | "session" = "long-term") => ({
  id,
  content,
  agent_id: "test-agent",
  user_id: "user1",
  metadata: {},
  entities: [],
  importance: 0.8,
  tier: "warm" as const,
  scope,
  session_id: null,
  namespace: "default",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe("local-first recall pipeline", () => {
  test("returns cached results when local cache has data", async () => {
    const client = mockClient();
    const cache = mockLocalCache([
      localMemory("local-1", "User prefers TypeScript", "long-term"),
    ]);
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "What are my preferences?" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client, localCache: cache };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("TypeScript");
    expect(client.search).not.toHaveBeenCalled();
  });

  test("falls back to API when local cache is empty", async () => {
    const client = mockClient(
      [{ memory: { id: "api-1", content: "API memory result", created_at: new Date().toISOString(), importance: 0.7 }, score: 0.8 }],
      [],
    );
    const cache = mockLocalCache([]);
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "What do you know?" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client, localCache: cache };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("API memory result");
    expect(client.search).toHaveBeenCalled();
  });

  test("triggers background refresh when cache is stale", async () => {
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const cache = mockLocalCache(
      [localMemory("local-1", "Stale but valid memory", "long-term")],
      { lastPull: staleTime },
    );
    const daemon = mockSyncDaemon();
    const client = mockClient();
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test", syncIntervalMinutes: 5 };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "Tell me something" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client, localCache: cache, syncDaemon: daemon };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("Stale but valid memory");
    expect(daemon.pull).toHaveBeenCalled();
    expect(client.search).not.toHaveBeenCalled();
  });

  test("does not trigger refresh when cache is fresh", async () => {
    const freshTime = new Date().toISOString(); // just now
    const cache = mockLocalCache(
      [localMemory("local-1", "Fresh cache memory", "long-term")],
      { lastPull: freshTime },
    );
    const daemon = mockSyncDaemon();
    const client = mockClient();
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test", syncIntervalMinutes: 5 };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "Tell me something" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client, localCache: cache, syncDaemon: daemon };
    await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(daemon.pull).not.toHaveBeenCalled();
  });

  test("graceful degradation: falls back to API on cache error", async () => {
    const errorCache: LocalCacheLike = {
      search: vi.fn(() => { throw new Error("SQLite corrupt"); }),
      getSyncState: vi.fn(() => ({ lastPull: null, lastPush: null, cursor: null })),
      count: vi.fn(() => 5),
    };
    const client = mockClient(
      [{ memory: { id: "api-1", content: "Fallback API memory", created_at: new Date().toISOString(), importance: 0.6 }, score: 0.75 }],
      [],
    );
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "Can you recall anything?" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client, localCache: errorCache };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("Fallback API memory");
    expect(client.search).toHaveBeenCalled();
  });

  test("falls back to API when local cache returns no matches", async () => {
    const cache: LocalCacheLike = {
      search: vi.fn(() => []),
      getSyncState: vi.fn(() => ({ lastPull: new Date().toISOString(), lastPush: null, cursor: null })),
      count: vi.fn(() => 10),
    };
    const client = mockClient(
      [{ memory: { id: "api-1", content: "API result for unmatched query", created_at: new Date().toISOString(), importance: 0.7 }, score: 0.8 }],
      [],
    );
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "Something not in cache" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client, localCache: cache };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("API result for unmatched query");
    expect(client.search).toHaveBeenCalled();
  });

  test("works without localCache (API-only mode)", async () => {
    const client = mockClient(
      [{ memory: { id: "api-1", content: "Pure API mode memory", created_at: new Date().toISOString(), importance: 0.8 }, score: 0.85 }],
      [],
    );
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "What do you know?" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("Pure API mode memory");
    expect(client.search).toHaveBeenCalled();
  });

  test("graceful degradation: count() throws, falls back to API", async () => {
    const errorCache: LocalCacheLike = {
      search: vi.fn(() => []),
      getSyncState: vi.fn(() => ({ lastPull: null, lastPush: null, cursor: null })),
      count: vi.fn(() => { throw new Error("DB locked"); }),
    };
    const client = mockClient(
      [{ memory: { id: "api-1", content: "Fallback from count error", created_at: new Date().toISOString(), importance: 0.6 }, score: 0.7 }],
      [],
    );
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "Recall something" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client, localCache: errorCache };
    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt, memories: [], scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("Fallback from count error");
    expect(client.search).toHaveBeenCalled();
  });
});
