// tests/integration/recall-pipeline.test.ts
import { describe, test, expect, vi } from "vitest";
import { runPipeline } from "../../src/pipelines/runner.js";
import { recallPipeline } from "../../src/pipelines/recall/index.js";
import { buildRequestContext } from "../../src/context/request-context.js";
import type { PipelineContext, RecallInput, MemoryRelayClient } from "../../src/pipelines/types.js";

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
