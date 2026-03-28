import { describe, test, expect } from "vitest";
import { captureTriggerGate } from "../../../src/pipelines/capture/trigger-gate.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(overrides: Partial<PipelineContext["requestCtx"]> = {}, configOverrides: any = {}): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "agent:main:abc", agentId: "main", channel: null, trigger: null,
      prompt: "real conversation prompt here", isSubagent: false,
      parentSessionKey: null, namespace: "default", timestamp: Date.now(),
      ...overrides,
    },
    config: { autoCapture: { enabled: true, tier: "smart" }, ...configOverrides } as any,
    client: {} as any,
  };
}
const input: CaptureInput = { messages: [{ role: "user", content: "hello world" }] };

describe("captureTriggerGate", () => {
  test("continues for interactive prompts", async () => {
    const result = await captureTriggerGate.execute(input, ctx());
    expect(result.action).toBe("continue");
  });
  test("skips for heartbeat trigger", async () => {
    const result = await captureTriggerGate.execute(input, ctx({ trigger: "heartbeat" }));
    expect(result.action).toBe("skip");
  });
  test("skips for subagent when policy is skip", async () => {
    const result = await captureTriggerGate.execute(input, ctx({ isSubagent: true }, { namespace: { subagentPolicy: "skip" } }));
    expect(result.action).toBe("skip");
  });
  test("continues for subagent when policy is inherit", async () => {
    const result = await captureTriggerGate.execute(input, ctx({ isSubagent: true }));
    expect(result.action).toBe("continue");
  });
});
