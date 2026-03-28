import { describe, test, expect } from "vitest";
import { recallTriggerGate } from "../../../src/pipelines/recall/trigger-gate.js";
import type { PipelineContext, RecallInput } from "../../../src/pipelines/types.js";

function ctx(overrides: Partial<PipelineContext["requestCtx"]> = {}): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "agent:main:abc", agentId: "main", channel: null, trigger: null,
      prompt: "How do I configure the database?", isSubagent: false,
      parentSessionKey: null, namespace: "default", timestamp: Date.now(),
      ...overrides,
    },
    config: { autoRecall: true } as any,
    client: {} as any,
  };
}
const input: RecallInput = { prompt: "test", memories: [], scope: "all" };

describe("recallTriggerGate", () => {
  test("is always enabled", () => { expect(recallTriggerGate.enabled(ctx())).toBe(true); });
  test("continues for interactive prompts", async () => {
    const result = await recallTriggerGate.execute(input, ctx());
    expect(result.action).toBe("continue");
  });
  test("skips for cron trigger", async () => {
    const result = await recallTriggerGate.execute(input, ctx({ trigger: "cron" }));
    expect(result.action).toBe("skip");
  });
  test("skips for HEARTBEAT_OK prompt", async () => {
    const result = await recallTriggerGate.execute(input, ctx({ prompt: "HEARTBEAT_OK" }));
    expect(result.action).toBe("skip");
  });
  test("skips for very short prompt", async () => {
    const result = await recallTriggerGate.execute(input, ctx({ prompt: "hi" }));
    expect(result.action).toBe("skip");
  });
});
