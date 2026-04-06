import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../../src/pipelines/types.js";

// We test the cooldown/gate logic by importing the module and checking behavior
// via the exported Map (tested indirectly through the hook registration)

describe("before-prompt-build recall gates", () => {
  test("registerBeforePromptBuild is a function", async () => {
    const { registerBeforePromptBuild } = await import("../../src/hooks/before-prompt-build.js");
    expect(typeof registerBeforePromptBuild).toBe("function");
  });

  test("skips recall when autoRecall is false", async () => {
    const { registerBeforePromptBuild } = await import("../../src/hooks/before-prompt-build.js");
    const events: any[] = [];
    const mockApi = {
      on: (event: string, handler: any) => events.push({ event, handler }),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    } as unknown as OpenClawPluginApi;
    const config = { autoRecall: false } as PluginConfig;
    const client = {} as any;

    registerBeforePromptBuild(mockApi, config, client);
    expect(events[0].event).toBe("before_prompt_build");

    // Call the handler with a prompt
    const result = await events[0].handler({ prompt: "what is the meaning of life?" });
    expect(result).toBeUndefined();
  });

  test("skips recall for short prompts under 20 chars", async () => {
    // Reimport to get fresh module state
    vi.resetModules();
    const { registerBeforePromptBuild } = await import("../../src/hooks/before-prompt-build.js");
    const events: any[] = [];
    const mockApi = {
      on: (event: string, handler: any) => events.push({ event, handler }),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    } as unknown as OpenClawPluginApi;

    const mockClient = { search: vi.fn() } as any;
    const config = { autoRecall: true, recallLimit: 3, recallThreshold: 0.5 } as PluginConfig;

    registerBeforePromptBuild(mockApi, config, mockClient);

    // Short prompt — should skip
    const result = await events[0].handler({ prompt: "ok" });
    expect(result).toBeUndefined();
    expect(mockClient.search).not.toHaveBeenCalled();
  });
});
