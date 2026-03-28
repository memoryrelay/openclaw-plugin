// tests/context/request-context.test.ts
import { describe, test, expect } from "vitest";
import { buildRequestContext } from "../../src/context/request-context.js";
import type { PluginConfig } from "../../src/pipelines/types.js";

const baseConfig: PluginConfig = { agentId: "fallback-agent" };

describe("buildRequestContext", () => {
  test("builds context from event with sessionKey", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc123" }, prompt: "  Hello world  " },
      baseConfig,
    );
    expect(ctx.sessionKey).toBe("agent:main:abc123");
    expect(ctx.prompt).toBe("Hello world");
    expect(ctx.isSubagent).toBe(false);
    expect(ctx.parentSessionKey).toBeNull();
    expect(ctx.agentId).toBe("main");
  });
  test("detects subagent from session key pattern", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:subagent:task-uuid-123" }, prompt: "test" },
      baseConfig,
    );
    expect(ctx.isSubagent).toBe(true);
    expect(ctx.agentId).toBe("main");
    expect(ctx.parentSessionKey).toBe("agent:main:task-uuid-123");
  });
  test("falls back to config agentId when no agent in session key", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "simple-session-123" }, prompt: "test" },
      baseConfig,
    );
    expect(ctx.agentId).toBe("fallback-agent");
    expect(ctx.isSubagent).toBe(false);
  });
  test("falls back to sessionId when no ctx.sessionKey", () => {
    const ctx = buildRequestContext(
      { sessionId: "legacy-session", prompt: "test" },
      baseConfig,
    );
    expect(ctx.sessionKey).toBe("legacy-session");
  });
  test("extracts channel from event", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "s1" }, channel: "telegram-123", prompt: "test" },
      baseConfig,
    );
    expect(ctx.channel).toBe("telegram-123");
  });
  test("extracts trigger from event ctx", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "s1", trigger: "cron" }, prompt: "HEARTBEAT_OK" },
      baseConfig,
    );
    expect(ctx.trigger).toBe("cron");
  });
  test("context is frozen (immutable)", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "s1" }, prompt: "test" },
      baseConfig,
    );
    expect(() => { (ctx as any).sessionKey = "hacked"; }).toThrow();
  });
  test("handles missing prompt gracefully", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "s1" } },
      baseConfig,
    );
    expect(ctx.prompt).toBe("");
  });
});
