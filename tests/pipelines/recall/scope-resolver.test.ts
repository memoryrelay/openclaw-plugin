import { describe, test, expect } from "vitest";
import { recallScopeResolver } from "../../../src/pipelines/recall/scope-resolver.js";
import type { PipelineContext, RecallInput } from "../../../src/pipelines/types.js";

function ctx(overrides: Partial<PipelineContext["requestCtx"]> = {}, configOverrides: any = {}): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "agent:main:abc", agentId: "main", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(), ...overrides,
    },
    config: { namespace: { subagentPolicy: "inherit" }, ...configOverrides } as any,
    client: {} as any,
  };
}
const input: RecallInput = { prompt: "test", memories: [], scope: "all" };

describe("recallScopeResolver", () => {
  test("passes through for normal agent", async () => {
    const result = await recallScopeResolver.execute(input, ctx());
    expect(result.action).toBe("continue");
    if (result.action === "continue") { expect(result.data.resolvedSessionKey).toBe("agent:main:abc"); }
  });
  test("routes subagent to parent session key when policy is inherit", async () => {
    const result = await recallScopeResolver.execute(input, ctx({
      isSubagent: true, parentSessionKey: "agent:main:task-123",
      sessionKey: "agent:main:subagent:task-123",
    }));
    expect(result.action).toBe("continue");
    if (result.action === "continue") { expect(result.data.resolvedSessionKey).toBe("agent:main:task-123"); }
  });
  test("skips for subagent when policy is skip", async () => {
    const result = await recallScopeResolver.execute(input, ctx(
      { isSubagent: true }, { namespace: { subagentPolicy: "skip" } },
    ));
    expect(result.action).toBe("skip");
  });
  test("uses own session key for subagent when policy is isolate", async () => {
    const result = await recallScopeResolver.execute(input, ctx(
      { isSubagent: true, sessionKey: "agent:main:subagent:xyz", parentSessionKey: "agent:main:xyz" },
      { namespace: { subagentPolicy: "isolate" } },
    ));
    expect(result.action).toBe("continue");
    if (result.action === "continue") { expect(result.data.resolvedSessionKey).toBe("agent:main:subagent:xyz"); }
  });
});
