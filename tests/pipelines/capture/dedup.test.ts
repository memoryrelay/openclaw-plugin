import { describe, test, expect, vi } from "vitest";
import { captureDedup } from "../../../src/pipelines/capture/dedup.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(searchResults: any[] = []): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: {} as any,
    client: {
      search: vi.fn(async () => searchResults),
      store: vi.fn(), list: vi.fn(), getOrCreateSession: vi.fn(), endSession: vi.fn(),
    },
  };
}

describe("captureDedup", () => {
  test("keeps messages with no near-duplicates", async () => {
    const input: CaptureInput = { messages: [{ role: "user", content: "My API key rotates every 30 days" }] };
    const result = await captureDedup.execute(input, ctx([]));
    expect(result.action).toBe("continue");
    if (result.action === "continue") { expect(result.data.messages.length).toBe(1); }
  });
  test("passes namespace from request context to search", async () => {
    const pctx = ctx([]);
    const input: CaptureInput = { messages: [{ role: "user", content: "test" }] };
    await captureDedup.execute(input, pctx);
    expect(pctx.client.search).toHaveBeenCalledWith("test", 1, 0.95, {
      namespace: "default",
    });
  });
  test("removes messages that already exist in memory", async () => {
    const input: CaptureInput = { messages: [{ role: "user", content: "My API key rotates every 30 days" }] };
    const existing = [{ memory: { id: "m1", content: "API key rotates monthly" }, score: 0.96 }];
    const result = await captureDedup.execute(input, ctx(existing));
    expect(result.action).toBe("skip");
  });
});
