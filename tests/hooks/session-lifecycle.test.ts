// tests/hooks/session-lifecycle.test.ts
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { registerBeforeAgentStart } from "../../src/hooks/before-agent-start.js";
import { registerAgentEnd, extractDecisions, generateSessionSummary } from "../../src/hooks/agent-end.js";
import { buildAutoSessionExternalId } from "../../src/hooks/auto-session-store.js";
import type { PluginConfig, MemoryRelayClient, ConversationMessage } from "../../src/pipelines/types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockClient(): MemoryRelayClient & {
  startSession: ReturnType<typeof vi.fn>;
  endSession: ReturnType<typeof vi.fn>;
  getProjectContext: ReturnType<typeof vi.fn>;
  recordDecision: ReturnType<typeof vi.fn>;
  getOrCreateSession: ReturnType<typeof vi.fn>;
} {
  return {
    search: vi.fn(async () => []),
    store: vi.fn(async () => ({ id: "mem-1", content: "", agent_id: "", user_id: "", metadata: {}, entities: [], created_at: "", updated_at: "" })),
    list: vi.fn(async () => []),
    getOrCreateSession: vi.fn(async () => ({ id: "auto-session-1" })),
    startSession: vi.fn(async () => ({ id: "auto-session-1" })),
    endSession: vi.fn(async () => {}),
    getProjectContext: vi.fn(async () => ({
      hot_memories: [{ content: "Project uses TypeScript" }],
      recent_decisions: [{ title: "Use Vitest", rationale: "Fast and modern" }],
      active_patterns: [{ title: "Pipeline pattern", description: "All operations use pipelines" }],
    })),
    recordDecision: vi.fn(async () => ({ id: "dec-1" })),
  };
}

type HookHandler = (event: any) => Promise<any>;

function mockApi(): {
  api: any;
  handlers: Map<string, HookHandler>;
} {
  const handlers = new Map<string, HookHandler>();
  const api = {
    on: vi.fn((event: string, handler: HookHandler) => {
      handlers.set(event, handler);
    }),
    logger: {
      debug: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    },
  };
  return { api, handlers };
}

const baseConfig: PluginConfig = {
  defaultProject: "test-project",
  autoCapture: { enabled: true, tier: "smart" },
};

// ============================================================================
// buildAutoSessionExternalId
// ============================================================================

describe("buildAutoSessionExternalId", () => {
  test("includes session key and date", () => {
    const date = new Date("2026-03-30T12:00:00Z");
    const id = buildAutoSessionExternalId("agent:abc:main", date);
    expect(id).toBe("auto:agent:abc:main:2026-03-30");
  });

  test("falls back to date-only when no session key", () => {
    const date = new Date("2026-03-30T12:00:00Z");
    const id = buildAutoSessionExternalId("", date);
    expect(id).toBe("auto:2026-03-30");
  });

  test("same key on same day produces identical external_id", () => {
    const date = new Date("2026-03-30T08:00:00Z");
    const id1 = buildAutoSessionExternalId("agent:abc:main", date);
    const id2 = buildAutoSessionExternalId("agent:abc:main", date);
    expect(id1).toBe(id2);
  });

  test("different keys produce different external_ids", () => {
    const date = new Date("2026-03-30T12:00:00Z");
    const id1 = buildAutoSessionExternalId("agent:abc:main", date);
    const id2 = buildAutoSessionExternalId("agent:xyz:main", date);
    expect(id1).not.toBe(id2);
  });

  test("different days produce different external_ids", () => {
    const day1 = new Date("2026-03-30T12:00:00Z");
    const day2 = new Date("2026-03-31T12:00:00Z");
    const id1 = buildAutoSessionExternalId("agent:abc:main", day1);
    const id2 = buildAutoSessionExternalId("agent:abc:main", day2);
    expect(id1).not.toBe(id2);
  });
});

// ============================================================================
// before-agent-start: auto session lifecycle
// ============================================================================

describe("before-agent-start: auto session lifecycle", () => {
  test("calls getOrCreateSession on before_agent_start", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;
    await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(client.getOrCreateSession).toHaveBeenCalledTimes(1);
    expect(client.getOrCreateSession).toHaveBeenCalledWith(
      expect.stringContaining("auto:agent:abc:main:"),
      "jarvis",
      expect.stringContaining("Auto session"),
      "test-project",
      expect.objectContaining({ source: "openclaw-plugin" }),
    );
  });

  test("does not call startSession (uses getOrCreateSession instead)", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;
    await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(client.startSession).not.toHaveBeenCalled();
  });

  test("reuses same external_id across multiple turns", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;

    await handler({
      prompt: "First message in this session",
      ctx: { sessionKey: "agent:abc:main" },
    });
    const firstCallArgs = client.getOrCreateSession.mock.calls[0];

    await handler({
      prompt: "Second message in this session",
      ctx: { sessionKey: "agent:abc:main" },
    });
    const secondCallArgs = client.getOrCreateSession.mock.calls[1];

    // Same external_id for both calls
    expect(firstCallArgs[0]).toBe(secondCallArgs[0]);
  });

  test("calls project_context with detected project", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;
    await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(client.getProjectContext).toHaveBeenCalledTimes(1);
    expect(client.getProjectContext).toHaveBeenCalledWith("test-project");
  });

  test("injects project context into prependContext", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;
    const result = await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(result.prependContext).toContain("Project Context (test-project)");
    expect(result.prependContext).toContain("Hot Memories");
    expect(result.prependContext).toContain("Project uses TypeScript");
  });

  test("session_start failure does not block the turn", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    client.getOrCreateSession.mockRejectedValue(new Error("network error"));
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;
    const result = await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    // Should still return workflow instructions
    expect(result.prependContext).toContain("memoryrelay-workflow");
    expect(api.logger.warn).toHaveBeenCalled();
  });

  test("project_context failure does not block the turn", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    client.getProjectContext.mockRejectedValue(new Error("project not found"));
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;
    const result = await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(result.prependContext).toContain("memoryrelay-workflow");
    expect(result.prependContext).not.toContain("Project Context");
  });

  test("detects project from env when no defaultProject", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    const configNoProject: PluginConfig = { autoCapture: { enabled: true, tier: "smart" } };

    const originalEnv = process.env.MEMORYRELAY_DEFAULT_PROJECT;
    process.env.MEMORYRELAY_DEFAULT_PROJECT = "env-project";
    try {
      registerBeforeAgentStart(api, configNoProject, client, () => true, undefined, "jarvis");
      const handler = handlers.get("before_agent_start")!;
      await handler({
        prompt: "Implement the feature",
        ctx: { sessionKey: "agent:abc:main" },
      });

      expect(client.getProjectContext).toHaveBeenCalledWith("env-project");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.MEMORYRELAY_DEFAULT_PROJECT;
      } else {
        process.env.MEMORYRELAY_DEFAULT_PROJECT = originalEnv;
      }
    }
  });

  test("skips short prompts", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;
    const result = await handler({ prompt: "hi" });

    expect(result).toBeUndefined();
    expect(client.getOrCreateSession).not.toHaveBeenCalled();
  });
});

// ============================================================================
// agent-end: auto session lifecycle
// ============================================================================

describe("agent-end: auto session lifecycle", () => {
  test("looks up session via getOrCreateSession and calls endSession", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();

    registerAgentEnd(api, baseConfig, client);

    const handler = handlers.get("agent_end")!;
    await handler({
      success: true,
      ctx: { sessionKey: "agent:abc:main" },
      messages: [
        { role: "user", content: "Fix the bug" },
        { role: "assistant", content: "I fixed the null pointer exception in the data processor by adding proper validation." },
      ],
    });

    // Should look up session via getOrCreateSession with same external_id pattern
    // Full args passed defensively in case before_agent_start failed
    expect(client.getOrCreateSession).toHaveBeenCalledTimes(1);
    expect(client.getOrCreateSession).toHaveBeenCalledWith(
      expect.stringContaining("auto:agent:abc:main:"),
      undefined,
      expect.stringContaining("Auto session"),
      "test-project",
      expect.objectContaining({ source: "openclaw-plugin", trigger: "agent_end" }),
    );

    expect(client.endSession).toHaveBeenCalledTimes(1);
    expect(client.endSession).toHaveBeenCalledWith("auto-session-1", expect.any(String));
  });

  test("session lookup failure does not crash", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    client.getOrCreateSession.mockRejectedValue(new Error("network error"));

    registerAgentEnd(api, baseConfig, client);

    const handler = handlers.get("agent_end")!;
    await handler({
      success: true,
      ctx: { sessionKey: "agent:abc:main" },
      messages: [
        { role: "user", content: "Fix the bug" },
        { role: "assistant", content: "Done fixing the bug." },
      ],
    });

    expect(client.endSession).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalled();
  });

  test("session_end failure is caught gracefully", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    client.endSession.mockRejectedValue(new Error("session not found"));

    registerAgentEnd(api, baseConfig, client);

    const handler = handlers.get("agent_end")!;
    // Should not throw
    await handler({
      success: true,
      ctx: { sessionKey: "agent:abc:main" },
      messages: [
        { role: "user", content: "Do something" },
        { role: "assistant", content: "Done with the implementation task." },
      ],
    });

    expect(api.logger.warn).toHaveBeenCalled();
  });
});

// ============================================================================
// autoSessions: false — disables all session hooks
// ============================================================================

describe("autoSessions: false", () => {
  const noSessionsConfig: PluginConfig = {
    ...baseConfig,
    autoSessions: false,
  };

  test("before-agent-start does not call getOrCreateSession when autoSessions is false", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, noSessionsConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;
    await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(client.getOrCreateSession).not.toHaveBeenCalled();
    expect(client.startSession).not.toHaveBeenCalled();
  });

  test("before-agent-start still returns workflow instructions when autoSessions is false", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, noSessionsConfig, client, () => true, "test-project", "jarvis");

    const handler = handlers.get("before_agent_start")!;
    const result = await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(result.prependContext).toContain("memoryrelay-workflow");
  });

  test("agent-end does not call getOrCreateSession or endSession when autoSessions is false", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerAgentEnd(api, noSessionsConfig, client);

    const handler = handlers.get("agent_end")!;
    await handler({
      success: true,
      ctx: { sessionKey: "agent:abc:main" },
      messages: [
        { role: "user", content: "Fix the bug" },
        { role: "assistant", content: "I fixed the null pointer exception in the data processor." },
      ],
    });

    expect(client.getOrCreateSession).not.toHaveBeenCalled();
    expect(client.endSession).not.toHaveBeenCalled();
  });

  test("session-lifecycle does not register session_end handler when autoSessions is false", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    const { registerSessionLifecycle } = await import("../../src/hooks/session-lifecycle.js");
    const { SessionResolver } = await import("../../src/context/session-resolver.js");
    const resolver = new SessionResolver(client, noSessionsConfig);

    registerSessionLifecycle(api, noSessionsConfig, client, "jarvis", "test-project", resolver);

    expect(handlers.has("session_end")).toBe(false);
  });
});

// ============================================================================
// autoCapture: false does NOT block session cleanup (regression test)
// ============================================================================

describe("autoCapture: false still closes sessions", () => {
  const noCaptureConfig: PluginConfig = {
    defaultProject: "test-project",
    autoCapture: { enabled: false, tier: "off" },
  };

  test("agent-end still calls endSession when autoCapture is disabled", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerAgentEnd(api, noCaptureConfig, client);

    // The handler should be registered even with autoCapture: false
    expect(handlers.has("agent_end")).toBe(true);

    const handler = handlers.get("agent_end")!;
    await handler({
      success: true,
      ctx: { sessionKey: "agent:abc:main" },
      messages: [
        { role: "user", content: "Fix the bug" },
        { role: "assistant", content: "I fixed the null pointer exception in the data processor." },
      ],
    });

    expect(client.getOrCreateSession).toHaveBeenCalledTimes(1);
    expect(client.endSession).toHaveBeenCalledTimes(1);
  });

  test("agent-end does not run capture pipeline when autoCapture is disabled", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerAgentEnd(api, noCaptureConfig, client);

    const handler = handlers.get("agent_end")!;
    await handler({
      success: true,
      ctx: { sessionKey: "agent:abc:main" },
      messages: [
        { role: "user", content: "Fix the bug" },
        { role: "assistant", content: "Done fixing the bug with proper validation." },
      ],
    });

    // Session should be closed
    expect(client.endSession).toHaveBeenCalledTimes(1);
    // But capture pipeline should not have run (no store calls beyond session lifecycle)
    expect(client.store).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Decision extraction (saliency-based, issue #132)
// ============================================================================

describe("extractDecisions", () => {
  test("detects high-confidence decision with explicit marker + rationale", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "We've decided to use PostgreSQL for the database layer because of its JSON support." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(1);
    expect(decisions[0].confidence).toBe("high");
    expect(decisions[0].score).toBeGreaterThanOrEqual(70);
  });

  test("detects decision with 'going with' + rationale", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "After reviewing the options, we're going with Redis instead of Memcached because of its data structure support." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(1);
    expect(decisions[0].score).toBeGreaterThanOrEqual(40);
  });

  test("detects decision with 'finally chosen' + rationale", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "We have finally chosen Vitest over Jest because of its speed and native TypeScript support." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(1);
    expect(decisions[0].score).toBeGreaterThanOrEqual(70);
  });

  test("records decisions via client on agent_end with confidence metadata", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();

    registerAgentEnd(api, baseConfig, client);

    const handler = handlers.get("agent_end")!;
    await handler({
      success: true,
      ctx: { sessionKey: "agent:abc:main" },
      messages: [
        { role: "user", content: "What database should we use?" },
        { role: "assistant", content: "We've decided to use PostgreSQL instead of MySQL because of its reliability and JSON support." },
      ],
    });

    expect(client.recordDecision).toHaveBeenCalledTimes(1);
    expect(client.recordDecision).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      undefined,
      "test-project",
      expect.arrayContaining(["auto-detected"]),
      undefined,
      expect.objectContaining({
        session_id: "auto-session-1",
        confidence: expect.any(String),
        saliency_score: expect.any(String),
      }),
    );
  });

  test("ignores user messages for decision extraction", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "We've decided to use MySQL because it's simple." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(0);
  });

  test("caps at 5 decisions", () => {
    const messages: ConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: "assistant" as const,
      content: `Decision: We've decided to use option ${i} instead of alternative ${i} because it's better.`,
    }));
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBeLessThanOrEqual(5);
  });

  test("rejects false positives: casual 'architecture' mention", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "Great question — this is a real architecture problem that we need to think carefully about." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(0);
  });

  test("rejects false positives: problem statement", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "We have a problem with the cache layer. This is broken in production." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(0);
  });

  test("rejects false positives: question about alternatives", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "Should we use Redis or Memcached? What if we went with a different approach?" },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(0);
  });
});

// ============================================================================
// Session summary generation
// ============================================================================

describe("generateSessionSummary", () => {
  test("generates summary from last assistant messages", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "First I analyzed the codebase structure and found the issue." },
      { role: "user", content: "Great" },
      { role: "assistant", content: "Then I implemented the fix by updating the validation logic." },
      { role: "assistant", content: "Finally I ran the tests and all 378 pass successfully." },
    ];
    const summary = generateSessionSummary(messages);
    expect(summary).toContain("validation logic");
    expect(summary).toContain("378 pass");
  });

  test("returns fallback for empty messages", () => {
    const summary = generateSessionSummary([]);
    expect(summary).toBe("Session completed.");
  });

  test("skips short assistant messages", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "OK" },
      { role: "assistant", content: "Done" },
      { role: "assistant", content: "I completed the full implementation of the authentication system with tests." },
    ];
    const summary = generateSessionSummary(messages);
    expect(summary).toContain("authentication system");
    expect(summary).not.toContain("OK");
  });
});
