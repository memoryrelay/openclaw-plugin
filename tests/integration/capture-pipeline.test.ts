// tests/integration/capture-pipeline.test.ts
import { describe, test, expect, vi } from "vitest";
import { runPipeline } from "../../src/pipelines/runner.js";
import { capturePipeline } from "../../src/pipelines/capture/index.js";
import { captureStore } from "../../src/pipelines/capture/store.js";
import { buildRequestContext } from "../../src/context/request-context.js";
import type { PipelineContext, CaptureInput, MemoryRelayClient, LocalCacheLike } from "../../src/pipelines/types.js";

function mockClient(): MemoryRelayClient {
  return {
    search: vi.fn(async () => []),
    store: vi.fn(async (content: string) => ({
      id: "m-new", content, agent_id: "a", user_id: "u",
      metadata: {}, entities: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })),
    list: vi.fn(), getOrCreateSession: vi.fn(), endSession: vi.fn(),
  };
}

function mockLocalCache(): LocalCacheLike & { _buffer: Array<{ content: string; metadata: Record<string, unknown> }> } {
  const cache = {
    _buffer: [] as Array<{ content: string; metadata: Record<string, unknown> }>,
    bufferWrite: vi.fn((content: string, metadata: Record<string, unknown>) => {
      cache._buffer.push({ content, metadata });
      return String(cache._buffer.length);
    }),
    bufferDepth: vi.fn(() => cache._buffer.length),
  };
  return cache;
}

function buildCtx(overrides: {
  client?: MemoryRelayClient;
  localCache?: LocalCacheLike;
  sessionKey?: string;
}): { pipelineCtx: PipelineContext; client: MemoryRelayClient } {
  const client = overrides.client ?? mockClient();
  const config = { autoCapture: { enabled: true, tier: "smart", maxMessageLength: 2000 }, agentId: "test" };
  const requestCtx = buildRequestContext(
    { ctx: { sessionKey: overrides.sessionKey ?? "agent:main:abc" }, prompt: "Test prompt" },
    config as any,
  );
  const pipelineCtx: PipelineContext = {
    requestCtx,
    config: config as any,
    client,
    localCache: overrides.localCache,
  };
  return { pipelineCtx, client };
}

const valuableMessages: CaptureInput = {
  messages: [
    { role: "user", content: "I always prefer PostgreSQL for production databases" },
    { role: "user", content: "Our deployment pipeline uses Docker Compose with health checks" },
  ],
};

describe("capture pipeline end-to-end", () => {
  test("filters noise and stores valuable content", async () => {
    const client = mockClient();
    const config = { autoCapture: { enabled: true, tier: "smart", maxMessageLength: 2000 }, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "Help me configure the database" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "I always prefer PostgreSQL for production databases" },
        { role: "user", content: "ok" },
        { role: "assistant", content: "Sure! How can I help you with that?" },
        { role: "assistant", content: "You should configure the DATABASE_URL in your .env file. The format is postgres://user:pass@host:5432/dbname" },
      ],
    };

    await runPipeline(capturePipeline, input, pipelineCtx);

    // "ok" dropped (noise), boilerplate dropped, 2 messages should be captured
    expect(client.store).toHaveBeenCalledTimes(2);
    const firstContent = (client.store as any).mock.calls[0][0];
    expect(firstContent).toContain("PostgreSQL");
    const secondContent = (client.store as any).mock.calls[1][0];
    expect(secondContent).toContain("DATABASE_URL");
  });

  test("skips entirely for heartbeat trigger", async () => {
    const client = mockClient();
    const config = { autoCapture: { enabled: true, tier: "smart" }, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "sys:heartbeat:check", trigger: "heartbeat" }, prompt: "HEARTBEAT_OK" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };
    const result = await runPipeline(capturePipeline, {
      messages: [{ role: "user", content: "HEARTBEAT_OK" }],
    }, pipelineCtx);

    expect(result).toBeNull();
    expect(client.store).not.toHaveBeenCalled();
  });

  test("skips capture for subagent with skip policy", async () => {
    const client = mockClient();
    const config = { autoCapture: { enabled: true }, agentId: "test", namespace: { subagentPolicy: "skip" } };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:subagent:xyz" }, prompt: "Subagent work" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };
    const result = await runPipeline(capturePipeline, {
      messages: [{ role: "user", content: "Some subagent conversation content here" }],
    }, pipelineCtx);

    expect(result).toBeNull();
    expect(client.store).not.toHaveBeenCalled();
  });

  test("handles all noise input gracefully", async () => {
    const client = mockClient();
    const config = { autoCapture: { enabled: true }, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "chat" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };
    const result = await runPipeline(capturePipeline, {
      messages: [
        { role: "user", content: "ok" },
        { role: "user", content: "thanks" },
        { role: "user", content: "done" },
      ],
    }, pipelineCtx);

    expect(result).toBeNull();
    expect(client.store).not.toHaveBeenCalled();
  });
});

describe("buffer-first capture", () => {
  test("writes to local buffer instead of API when cache available", async () => {
    const localCache = mockLocalCache();
    const { pipelineCtx, client } = buildCtx({ localCache });

    await runPipeline(capturePipeline, valuableMessages, pipelineCtx);

    expect(localCache.bufferWrite).toHaveBeenCalled();
    expect(client.store).not.toHaveBeenCalled();
  });

  test("returns immediately without API call", async () => {
    const localCache = mockLocalCache();
    const { pipelineCtx, client } = buildCtx({ localCache });

    const start = performance.now();
    await runPipeline(capturePipeline, valuableMessages, pipelineCtx);
    const elapsed = performance.now() - start;

    expect(client.store).not.toHaveBeenCalled();
    // Buffer writes are synchronous SQLite — should complete well under 50ms in test
    expect(elapsed).toBeLessThan(50);
  });

  test("bufferDepth increases after capture", async () => {
    const localCache = mockLocalCache();
    const { pipelineCtx } = buildCtx({ localCache });

    expect(localCache.bufferDepth()).toBe(0);
    await runPipeline(capturePipeline, valuableMessages, pipelineCtx);
    expect(localCache.bufferDepth()).toBeGreaterThan(0);
  });

  test("store stage result includes buffered flag", async () => {
    const localCache = mockLocalCache();
    const { pipelineCtx } = buildCtx({ localCache });

    const input: CaptureInput = {
      messages: [{ role: "user", content: "I prefer TypeScript for all backend services" }],
    };
    const result = await captureStore.execute(input, pipelineCtx);

    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.buffered).toBe(true);
    }
  });

  test("store stage result has buffered=false when no cache", async () => {
    const { pipelineCtx } = buildCtx({});

    const input: CaptureInput = {
      messages: [{ role: "user", content: "I prefer TypeScript for all backend services" }],
    };
    const result = await captureStore.execute(input, pipelineCtx);

    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.buffered).toBe(false);
    }
  });

  test("falls back to API when cache is disabled (not provided)", async () => {
    const { pipelineCtx, client } = buildCtx({});

    await runPipeline(capturePipeline, valuableMessages, pipelineCtx);

    expect(client.store).toHaveBeenCalled();
  });

  test("falls back to API when bufferWrite throws", async () => {
    const localCache: LocalCacheLike = {
      bufferWrite: vi.fn(() => { throw new Error("disk full"); }),
      bufferDepth: vi.fn(() => 0),
    };
    const { pipelineCtx, client } = buildCtx({ localCache });

    await runPipeline(capturePipeline, valuableMessages, pipelineCtx);

    // Should have fallen back to API for each message
    expect(client.store).toHaveBeenCalled();
  });

  test("buffer receives correct metadata including scope and namespace", async () => {
    const localCache = mockLocalCache();
    const { pipelineCtx } = buildCtx({ localCache });

    await runPipeline(capturePipeline, {
      messages: [{ role: "user", content: "I prefer PostgreSQL for production databases" }],
    }, pipelineCtx);

    expect(localCache.bufferWrite).toHaveBeenCalledTimes(1);
    const [content, metadata] = (localCache.bufferWrite as any).mock.calls[0];
    expect(content).toContain("PostgreSQL");
    expect(metadata.source).toBe("auto-capture");
    expect(metadata.scope).toBeDefined();
    expect(metadata.namespace).toBeDefined();
  });
});
