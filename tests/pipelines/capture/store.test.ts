import { describe, test, expect, vi } from "vitest";
import { captureStore } from "../../../src/pipelines/capture/store.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: {} as any,
    client: {
      search: vi.fn(), list: vi.fn(), getOrCreateSession: vi.fn(), endSession: vi.fn(),
      store: vi.fn(async (content: string) => ({
        id: "mem-new", content, agent_id: "a1", user_id: "u1",
        metadata: {}, entities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })),
    },
  };
}

describe("captureStore", () => {
  test("stores messages with resolved scope", async () => {
    const pctx = ctx();
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "I always prefer dark mode for my IDE" },
        { role: "user", content: "The error is on line 42 of the config file" },
      ],
    };
    const result = await captureStore.execute(input, pctx);
    expect(result.action).toBe("continue");
    expect(pctx.client.store).toHaveBeenCalledTimes(2);
    const firstCall = (pctx.client.store as any).mock.calls[0];
    expect(firstCall[0]).toContain("dark mode");
    const secondCall = (pctx.client.store as any).mock.calls[1];
    expect(secondCall[0]).toContain("line 42");
  });
  test("caps at 3 stored memories per capture", async () => {
    const pctx = ctx();
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "I always use TypeScript for new projects" },
        { role: "user", content: "Remember that the deploy needs approval" },
        { role: "user", content: "The API endpoint is api.example.com" },
        { role: "user", content: "I decided to use PostgreSQL for this" },
        { role: "user", content: "The convention is to use kebab-case" },
      ],
    };
    await captureStore.execute(input, pctx);
    expect(pctx.client.store).toHaveBeenCalledTimes(3);
  });
});
