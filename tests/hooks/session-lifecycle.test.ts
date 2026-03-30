// tests/hooks/session-lifecycle.test.ts
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { registerBeforeAgentStart } from "../../src/hooks/before-agent-start.js";
import { registerAgentEnd, extractDecisions, generateSessionSummary } from "../../src/hooks/agent-end.js";
import { autoSessionMap } from "../../src/hooks/auto-session-store.js";
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
    getOrCreateSession: vi.fn(async () => ({ id: "session-existing" })),
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
// before-agent-start: auto session lifecycle
// ============================================================================

describe("before-agent-start: auto session lifecycle", () => {
  beforeEach(() => {
    autoSessionMap.clear();
  });
  afterEach(() => {
    autoSessionMap.clear();
  });

  test("calls session_start on before_agent_start", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project");

    const handler = handlers.get("before_agent_start")!;
    await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(client.startSession).toHaveBeenCalledTimes(1);
    expect(client.startSession).toHaveBeenCalledWith(
      expect.stringContaining("Auto session"),
      "test-project",
      expect.objectContaining({ source: "openclaw-plugin" }),
    );
  });

  test("calls project_context with detected project", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project");

    const handler = handlers.get("before_agent_start")!;
    await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(client.getProjectContext).toHaveBeenCalledTimes(1);
    expect(client.getProjectContext).toHaveBeenCalledWith("test-project");
  });

  test("stores session_id in autoSessionMap", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project");

    const handler = handlers.get("before_agent_start")!;
    await handler({
      prompt: "Implement the feature",
      ctx: { sessionKey: "agent:abc:main" },
    });

    expect(autoSessionMap.get("agent:abc:main")).toBe("auto-session-1");
  });

  test("injects project context into prependContext", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project");

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
    client.startSession.mockRejectedValue(new Error("network error"));
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project");

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
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project");

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
      registerBeforeAgentStart(api, configNoProject, client, () => true, undefined);
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
    registerBeforeAgentStart(api, baseConfig, client, () => true, "test-project");

    const handler = handlers.get("before_agent_start")!;
    const result = await handler({ prompt: "hi" });

    expect(result).toBeUndefined();
    expect(client.startSession).not.toHaveBeenCalled();
  });
});

// ============================================================================
// agent-end: auto session lifecycle
// ============================================================================

describe("agent-end: auto session lifecycle", () => {
  beforeEach(() => {
    autoSessionMap.clear();
  });
  afterEach(() => {
    autoSessionMap.clear();
  });

  test("calls session_end on agent_end when session was started", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    autoSessionMap.set("agent:abc:main", "auto-session-1");

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

    expect(client.endSession).toHaveBeenCalledTimes(1);
    expect(client.endSession).toHaveBeenCalledWith("auto-session-1", expect.any(String));
  });

  test("no session_end if no session was started", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    // autoSessionMap is empty — no session started

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
  });

  test("cleans up session from autoSessionMap after end", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    autoSessionMap.set("agent:abc:main", "auto-session-1");

    registerAgentEnd(api, baseConfig, client);

    const handler = handlers.get("agent_end")!;
    await handler({
      success: true,
      ctx: { sessionKey: "agent:abc:main" },
      messages: [
        { role: "user", content: "Do something" },
        { role: "assistant", content: "Done with the implementation task." },
      ],
    });

    expect(autoSessionMap.has("agent:abc:main")).toBe(false);
  });

  test("session_end failure is caught gracefully", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    client.endSession.mockRejectedValue(new Error("session not found"));
    autoSessionMap.set("agent:abc:main", "auto-session-1");

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
    // Should still clean up
    expect(autoSessionMap.has("agent:abc:main")).toBe(false);
  });
});

// ============================================================================
// Decision extraction heuristics
// ============================================================================

describe("extractDecisions", () => {
  test("detects 'we decided' keyword", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "We decided to use PostgreSQL for the database layer because of its JSON support." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(1);
    expect(decisions[0].title).toContain("decided");
  });

  test("detects 'going with' keyword", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "After reviewing the options, we're going with Redis for the cache layer." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(1);
    expect(decisions[0].rationale).toContain("going with");
  });

  test("detects 'chosen' keyword", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "We have chosen Vitest as our test framework for its speed and TypeScript support." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(1);
    expect(decisions[0].title).toContain("chosen");
  });

  test("records decisions via client on agent_end", async () => {
    const { api, handlers } = mockApi();
    const client = mockClient();
    autoSessionMap.set("agent:abc:main", "auto-session-1");

    registerAgentEnd(api, baseConfig, client);

    const handler = handlers.get("agent_end")!;
    await handler({
      success: true,
      ctx: { sessionKey: "agent:abc:main" },
      messages: [
        { role: "user", content: "What database should we use?" },
        { role: "assistant", content: "We decided to use PostgreSQL for the database because of its reliability and JSON support." },
      ],
    });

    expect(client.recordDecision).toHaveBeenCalledTimes(1);
    expect(client.recordDecision).toHaveBeenCalledWith(
      expect.stringContaining("decided"),
      expect.any(String),
      undefined,
      "test-project",
      ["auto-detected"],
      undefined,
      expect.objectContaining({ session_id: "auto-session-1" }),
    );
  });

  test("ignores user messages for decision extraction", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "We decided to use MySQL." },
    ];
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBe(0);
  });

  test("caps at 5 decisions", () => {
    const messages: ConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: "assistant" as const,
      content: `We decided to use option ${i} for component ${i}. Going with approach ${i} instead of alternative.`,
    }));
    const decisions = extractDecisions(messages);
    expect(decisions.length).toBeLessThanOrEqual(5);
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
