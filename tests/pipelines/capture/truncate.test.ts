import { describe, test, expect } from "vitest";
import { captureTruncate } from "../../../src/pipelines/capture/truncate.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(maxLen?: number): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: { autoCapture: { maxMessageLength: maxLen ?? 2000 } } as any, client: {} as any,
  };
}

describe("captureTruncate", () => {
  test("truncates messages over limit", async () => {
    const longContent = "x".repeat(3000);
    const input: CaptureInput = { messages: [{ role: "user", content: longContent }] };
    const result = await captureTruncate.execute(input, ctx(2000));
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.messages[0].content.length).toBe(2001);
    }
  });
  test("leaves short messages unchanged", async () => {
    const input: CaptureInput = { messages: [{ role: "user", content: "short message" }] };
    const result = await captureTruncate.execute(input, ctx());
    expect(result.action).toBe("continue");
    if (result.action === "continue") { expect(result.data.messages[0].content).toBe("short message"); }
  });
});
