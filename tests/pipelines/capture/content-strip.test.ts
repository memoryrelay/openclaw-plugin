import { describe, test, expect } from "vitest";
import { captureContentStrip } from "../../../src/pipelines/capture/content-strip.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: { autoCapture: { stripLargeCodeBlocks: true } } as any, client: {} as any,
  };
}

describe("captureContentStrip", () => {
  test("strips workflow blocks from messages", async () => {
    const input: CaptureInput = {
      messages: [{ role: "user", content: "Important fact <memoryrelay-workflow>stuff</memoryrelay-workflow> here" }],
    };
    const result = await captureContentStrip.execute(input, ctx());
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.messages[0].content).not.toContain("memoryrelay-workflow");
      expect(result.data.messages[0].content).toContain("Important fact");
    }
  });
  test("drops messages that become empty after stripping", async () => {
    const input: CaptureInput = {
      messages: [{ role: "system", content: "<system-reminder>only this</system-reminder>" }],
    };
    const result = await captureContentStrip.execute(input, ctx());
    expect(result.action).toBe("skip");
  });
});
