import { describe, test, expect, vi } from "vitest";
import { registerAgentEnd } from "../../src/hooks/agent-end.js";
import type { PluginConfig } from "../../src/pipelines/types.js";

function fakeApi() {
  const handlers: Record<string, (event: any) => Promise<unknown>> = {};
  return {
    api: {
      on: (name: string, fn: (event: any) => Promise<unknown>) => { handlers[name] = fn; },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any,
    handlers,
  };
}

function client() {
  return {
    search: vi.fn(async () => []),
    list: vi.fn(async () => []),
    store: vi.fn(async (content: string) => ({
      id: "m1", content, agent_id: "a1", user_id: "u1", metadata: {}, entities: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })),
  };
}

describe("registerAgentEnd", () => {
  test("runs the capture pipeline when autoCapture is on; no sessions, no decisions", async () => {
    const { api, handlers } = fakeApi();
    const c = client();
    const config: PluginConfig = { agentId: "a1", autoCapture: { enabled: true, tier: "aggressive" } } as PluginConfig;
    registerAgentEnd(api, config, c as any);

    await handlers["agent_end"]({
      success: true,
      prompt: "Please remember my editor preferences",
      ctx: { sessionKey: "agent:a1:s-" + Math.random() },
      messages: [
        { role: "user", content: "Remember that I always prefer dark mode for my IDE, it matters to me." },
        { role: "assistant", content: "Noted: dark mode it is." },
      ],
    });

    expect(c.store).toHaveBeenCalled();
    const [content, metadata] = (c.store as any).mock.calls[0];
    expect(content).toContain("dark mode");
    expect(metadata).toMatchObject({ source: "auto-capture" });
    // Nothing else is called: the API keeps no sessions or decisions.
    expect(Object.keys(c)).toEqual(["search", "list", "store"]);
  });

  test("does nothing when autoCapture is off", async () => {
    const { api, handlers } = fakeApi();
    const c = client();
    registerAgentEnd(api, { agentId: "a1", autoCapture: { enabled: false, tier: "off" } } as PluginConfig, c as any);
    await handlers["agent_end"]({ success: true, prompt: "Please remember this", ctx: { sessionKey: "k" }, messages: [{ role: "user", content: "I always prefer tabs over spaces" }] });
    expect(c.store).not.toHaveBeenCalled();
  });
});
