import { describe, test, expect } from "vitest";
import { captureMessageFilter } from "../../../src/pipelines/capture/message-filter.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: {} as any, client: {} as any,
  };
}

describe("captureMessageFilter", () => {
  test("drops noise messages and keeps real ones", async () => {
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "How do I configure the database?" },
        { role: "user", content: "ok" },
        { role: "user", content: "HEARTBEAT_OK" },
        { role: "assistant", content: "You can configure it by editing the .env file with your connection string." },
        { role: "assistant", content: "Sure! How can I help you with that?" },
      ],
    };
    const result = await captureMessageFilter.execute(input, ctx());
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.messages.length).toBe(2);
      expect(result.data.messages[0].content).toContain("database");
      expect(result.data.messages[1].content).toContain(".env");
    }
  });
  test("skips when all messages are noise", async () => {
    const input: CaptureInput = { messages: [{ role: "user", content: "ok" }, { role: "user", content: "thanks" }] };
    const result = await captureMessageFilter.execute(input, ctx());
    expect(result.action).toBe("skip");
  });
});
