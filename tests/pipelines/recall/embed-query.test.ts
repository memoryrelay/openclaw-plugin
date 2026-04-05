import { describe, test, expect, vi } from "vitest";
import { recallEmbedQuery } from "../../../src/pipelines/recall/embed-query.js";
import type { PipelineContext, RecallInput, EmbeddingService } from "../../../src/pipelines/types.js";

const EMBEDDING_DIM = 768;

function baseCtx(overrides?: { embeddingService?: EmbeddingService; vectorSearchEnabled?: boolean }): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "agent:main:abc", agentId: "a1", channel: null, trigger: null,
      prompt: "test query", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: {
      autoRecall: true,
      vectorSearch: { enabled: overrides?.vectorSearchEnabled ?? true },
    } as any,
    client: {} as any,
    embeddingService: overrides?.embeddingService,
  };
}

function input(overrides?: Partial<RecallInput>): RecallInput {
  return { prompt: "test query", memories: [], scope: "all", ...overrides };
}

describe("recallEmbedQuery", () => {
  test("is enabled when vectorSearch.enabled is true", () => {
    const ctx = baseCtx({ vectorSearchEnabled: true });
    expect(recallEmbedQuery.enabled(ctx)).toBe(true);
  });

  test("is disabled when vectorSearch.enabled is false", () => {
    const ctx = baseCtx({ vectorSearchEnabled: false });
    expect(recallEmbedQuery.enabled(ctx)).toBe(false);
  });

  test("is disabled when vectorSearch config is absent", () => {
    const ctx: PipelineContext = {
      requestCtx: {
        sessionKey: "agent:main:abc", agentId: "a1", channel: null, trigger: null,
        prompt: "test query", isSubagent: false, parentSessionKey: null,
        namespace: "default", timestamp: Date.now(),
      },
      config: { autoRecall: true } as any,
      client: {} as any,
    };
    expect(recallEmbedQuery.enabled(ctx)).toBe(false);
  });

  test("sets queryEmbedding when embeddingService returns a vector", async () => {
    const embedding = new Float32Array(EMBEDDING_DIM).fill(0.1);
    const embeddingService: EmbeddingService = {
      generateQuery: vi.fn(async () => embedding),
    };
    const ctx = baseCtx({ embeddingService });
    const result = await recallEmbedQuery.execute(input(), ctx);

    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.queryEmbedding).toBe(embedding);
    }
    expect(embeddingService.generateQuery).toHaveBeenCalledWith("test query");
  });

  test("passes input unchanged when vectorSearch is enabled but no embeddingService is configured", async () => {
    // Realistic misconfiguration: vectorSearch enabled in config but no service wired up
    const ctx = baseCtx({ vectorSearchEnabled: true }); // no embeddingService
    const inp = input();
    const result = await recallEmbedQuery.execute(inp, ctx);

    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.queryEmbedding).toBeUndefined();
      expect(result.data.prompt).toBe("test query");
    }
  });

  test("sets queryEmbedding=null on embedding failure (graceful fallback)", async () => {
    const embeddingService: EmbeddingService = {
      generateQuery: vi.fn(async () => { throw new Error("ONNX model not loaded"); }),
    };
    const ctx = baseCtx({ embeddingService });
    const result = await recallEmbedQuery.execute(input(), ctx);

    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.queryEmbedding).toBeNull();
    }
  });

  test("never returns skip — always continues pipeline", async () => {
    const ctx = baseCtx();
    const result = await recallEmbedQuery.execute(input(), ctx);
    expect(result.action).toBe("continue");
  });

  test("preserves existing input fields when embedding is set", async () => {
    const embedding = new Float32Array(EMBEDDING_DIM);
    const embeddingService: EmbeddingService = {
      generateQuery: vi.fn(async () => embedding),
    };
    const ctx = baseCtx({ embeddingService });
    const inp = input({ scope: "session", resolvedSessionKey: "key-123" });
    const result = await recallEmbedQuery.execute(inp, ctx);

    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.scope).toBe("session");
      expect(result.data.resolvedSessionKey).toBe("key-123");
      expect(result.data.queryEmbedding).toBe(embedding);
    }
  });
});
