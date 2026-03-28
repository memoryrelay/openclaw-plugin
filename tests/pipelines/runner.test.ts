import { describe, test, expect } from "vitest";
import { runPipeline } from "../../src/pipelines/runner.js";
import type { PipelineContext, RecallStage, RecallInput, CaptureStage, CaptureInput } from "../../src/pipelines/types.js";

function mockPipelineContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "test-session",
      agentId: "test-agent",
      channel: null,
      trigger: null,
      prompt: "test prompt",
      isSubagent: false,
      parentSessionKey: null,
      namespace: "default",
      timestamp: Date.now(),
    },
    config: {} as any,
    client: {} as any,
    ...overrides,
  };
}

describe("runPipeline", () => {
  test("executes stages in order and returns final output", async () => {
    const log: string[] = [];
    const stage1: RecallStage = {
      name: "stage1",
      enabled: () => true,
      execute: async (input, _ctx) => {
        log.push("stage1");
        return { action: "continue", data: { ...input, prompt: input.prompt + "-s1" } };
      },
    };
    const stage2: RecallStage = {
      name: "stage2",
      enabled: () => true,
      execute: async (input, _ctx) => {
        log.push("stage2");
        return { action: "continue", data: { ...input, prompt: input.prompt + "-s2" } };
      },
    };
    const input: RecallInput = { prompt: "hello", memories: [], scope: "all" };
    const result = await runPipeline([stage1, stage2], input, mockPipelineContext());
    expect(result).not.toBeNull();
    expect(result!.prompt).toBe("hello-s1-s2");
    expect(log).toEqual(["stage1", "stage2"]);
  });

  test("short-circuits on skip", async () => {
    const log: string[] = [];
    const stage1: RecallStage = {
      name: "skipper",
      enabled: () => true,
      execute: async (_input, _ctx) => {
        log.push("skipper");
        return { action: "skip" };
      },
    };
    const stage2: RecallStage = {
      name: "never-reached",
      enabled: () => true,
      execute: async (input, _ctx) => {
        log.push("never-reached");
        return { action: "continue", data: input };
      },
    };
    const input: RecallInput = { prompt: "hello", memories: [], scope: "all" };
    const result = await runPipeline([stage1, stage2], input, mockPipelineContext());
    expect(result).toBeNull();
    expect(log).toEqual(["skipper"]);
  });

  test("skips disabled stages", async () => {
    const log: string[] = [];
    const enabled: RecallStage = {
      name: "enabled",
      enabled: () => true,
      execute: async (input, _ctx) => {
        log.push("enabled");
        return { action: "continue", data: input };
      },
    };
    const disabled: RecallStage = {
      name: "disabled",
      enabled: () => false,
      execute: async (input, _ctx) => {
        log.push("disabled");
        return { action: "continue", data: input };
      },
    };
    const input: RecallInput = { prompt: "hello", memories: [], scope: "all" };
    await runPipeline([enabled, disabled, enabled], input, mockPipelineContext());
    expect(log).toEqual(["enabled", "enabled"]);
  });

  test("returns input unchanged when all stages are disabled", async () => {
    const disabled: RecallStage = {
      name: "disabled",
      enabled: () => false,
      execute: async (input, _ctx) => ({ action: "continue", data: input }),
    };
    const input: RecallInput = { prompt: "unchanged", memories: [], scope: "all" };
    const result = await runPipeline([disabled], input, mockPipelineContext());
    expect(result).toEqual(input);
  });

  test("works with empty stage array", async () => {
    const input: RecallInput = { prompt: "empty", memories: [], scope: "all" };
    const result = await runPipeline([], input, mockPipelineContext());
    expect(result).toEqual(input);
  });
});
