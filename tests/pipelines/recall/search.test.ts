import { describe, test, expect, vi } from "vitest";
import { recallSearch } from "../../../src/pipelines/recall/search.js";
import type { PipelineContext, RecallInput } from "../../../src/pipelines/types.js";

function baseCtx(overrides?: { localCache?: any }): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "agent:main:abc", agentId: "a1", channel: null, trigger: null,
      prompt: "test query", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: { autoRecall: true, recallLimit: 5, recallThreshold: 0.3 } as any,
    client: {
      search: vi.fn(async () => []),
      store: vi.fn(), list: vi.fn(),
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
  test("session search carries the OpenClaw session key as session_id", async () => {
    const ctx = baseCtx();
    await recallSearch.execute(input(), ctx);

    const sessionCall = (ctx.client.search as any).mock.calls.find(
      (c: any[]) => c[3]?.scope === "session",
    );
    expect(sessionCall).toBeDefined();
    expect(sessionCall[3].session_id).toBe("agent:main:abc");
    const longTermCall = (ctx.client.search as any).mock.calls.find(
      (c: any[]) => c[3]?.scope === "long-term",
    );
    expect(longTermCall[3]).not.toHaveProperty("session_id");
  });

  test("uses the overridden resolvedSessionKey for subagent routing", async () => {
    const ctx = baseCtx();
    await recallSearch.execute(input({ resolvedSessionKey: "agent:main:parent-key" }), ctx);

    const sessionCall = (ctx.client.search as any).mock.calls.find(
      (c: any[]) => c[3]?.scope === "session",
    );
    expect(sessionCall[3].session_id).toBe("agent:main:parent-key");
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
