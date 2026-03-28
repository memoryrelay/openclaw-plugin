// tests/integration/capture-pipeline.test.ts
import { describe, test, expect, vi } from "vitest";
import { runPipeline } from "../../src/pipelines/runner.js";
import { capturePipeline } from "../../src/pipelines/capture/index.js";
import { buildRequestContext } from "../../src/context/request-context.js";
import type { PipelineContext, CaptureInput, MemoryRelayClient } from "../../src/pipelines/types.js";

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
