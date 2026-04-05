import { describe, test, expect, vi } from "vitest";
import { recallSearch } from "../../../src/pipelines/recall/search.js";
import type { PipelineContext, RecallInput, SessionResolverLike } from "../../../src/pipelines/types.js";

function baseCtx(overrides?: { sessionResolver?: SessionResolverLike; localCache?: any }): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "agent:main:abc", agentId: "a1", channel: null, trigger: null,
      prompt: "test query", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: { autoRecall: true, recallLimit: 5, recallThreshold: 0.3 } as any,
    client: {
      search: vi.fn(async () => []),
      store: vi.fn(), list: vi.fn(), getOrCreateSession: vi.fn(), endSession: vi.fn(),
    },
    ...overrides,
  };
}

function input(overrides?: Partial<RecallInput>): RecallInput {
  return {
    prompt: "test query",
    memories: [],
    scope: "all",
    ...overrides,
  };
}

describe("recallSearch", () => {
  test("uses raw session key when no sessionResolver is provided", async () => {
    const ctx = baseCtx();
    await recallSearch.execute(input(), ctx);

    const sessionCall = (ctx.client.search as any).mock.calls.find(
      (c: any[]) => c[3]?.scope === "session",
    );
    expect(sessionCall).toBeDefined();
    expect(sessionCall[3].session_id).toBe("agent:main:abc");
  });

  test("resolves session UUID via sessionResolver", async () => {
    const resolver: SessionResolverLike = {
      resolve: vi.fn(async () => ({ sessionId: "uuid-1234", externalId: "agent:main:abc" })),
    };
    const ctx = baseCtx({ sessionResolver: resolver });
    await recallSearch.execute(input(), ctx);

    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    const sessionCall = (ctx.client.search as any).mock.calls.find(
      (c: any[]) => c[3]?.scope === "session",
    );
    expect(sessionCall[3].session_id).toBe("uuid-1234");
  });

  test("falls back to raw session key when sessionResolver throws", async () => {
    const resolver: SessionResolverLike = {
      resolve: vi.fn(async () => { throw new Error("network error"); }),
    };
    const ctx = baseCtx({ sessionResolver: resolver });
    await recallSearch.execute(input(), ctx);

    const sessionCall = (ctx.client.search as any).mock.calls.find(
      (c: any[]) => c[3]?.scope === "session",
    );
    expect(sessionCall[3].session_id).toBe("agent:main:abc");
  });

  test("resolves with overridden resolvedSessionKey for subagent routing", async () => {
    const resolver: SessionResolverLike = {
      resolve: vi.fn(async (reqCtx) => ({
        sessionId: `uuid-for-${reqCtx.sessionKey}`,
        externalId: reqCtx.sessionKey,
      })),
    };
    const ctx = baseCtx({ sessionResolver: resolver });
    await recallSearch.execute(input({ resolvedSessionKey: "agent:main:parent-key" }), ctx);

    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "agent:main:parent-key" }),
    );
    const sessionCall = (ctx.client.search as any).mock.calls.find(
      (c: any[]) => c[3]?.scope === "session",
    );
    expect(sessionCall[3].session_id).toBe("uuid-for-agent:main:parent-key");
  });

  test("passes queryEmbedding from RecallInput to localCache.search()", async () => {
    const mockSearch = vi.fn().mockReturnValue([]);
    const localCache = {
      count: vi.fn().mockReturnValue(1),
      search: mockSearch,
      getSyncState: vi.fn().mockReturnValue({ lastPull: null, lastPush: null, cursor: null }),
      bufferWrite: vi.fn(),
      bufferDepth: vi.fn().mockReturnValue(0),
      close: vi.fn(),
    };

    const ctx = baseCtx({ localCache });
    const queryEmbedding = new Float32Array(768);
    await recallSearch.execute(input({ queryEmbedding }), ctx);

    // Both long-term and session search calls should receive the queryEmbedding
    expect(mockSearch).toHaveBeenCalledTimes(2);
    for (const call of mockSearch.mock.calls) {
      expect(call[1]).toMatchObject({ queryEmbedding });
    }
  });

  test("passes queryEmbedding=null when not provided in RecallInput", async () => {
    const mockSearch = vi.fn().mockReturnValue([]);
    const localCache = {
      count: vi.fn().mockReturnValue(1),
      search: mockSearch,
      getSyncState: vi.fn().mockReturnValue({ lastPull: null, lastPush: null, cursor: null }),
      bufferWrite: vi.fn(),
      bufferDepth: vi.fn().mockReturnValue(0),
      close: vi.fn(),
    };

    const ctx = baseCtx({ localCache });
    await recallSearch.execute(input(), ctx);

    expect(mockSearch).toHaveBeenCalledTimes(2);
    for (const call of mockSearch.mock.calls) {
      expect(call[1]).toMatchObject({ queryEmbedding: undefined });
    }
  });
});
