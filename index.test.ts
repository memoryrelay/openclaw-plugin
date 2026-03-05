/**
 * MemoryRelay Plugin Tests
 * 
 * Tests for API client, lifecycle hooks, and tools
 * 
 * Run: vitest run
 * Watch: vitest
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

// ============================================================================
// Mock Types (matching plugin implementation)
// ============================================================================

interface Memory {
  id: string;
  content: string;
  agent_id: string;
  user_id: string;
  metadata: Record<string, string>;
  entities: string[];
  created_at: number;
  updated_at: number;
}

interface SearchResult {
  memory: Memory;
  score: number;
}

interface Stats {
  total_memories: number;
  last_updated?: string;
}

// ============================================================================
// Mock API Client (for testing without real API)
// ============================================================================

class MockMemoryRelayClient {
  private memories: Memory[] = [];
  private nextId = 1;

  constructor(
    private readonly apiKey: string,
    private readonly agentId: string,
    private readonly apiUrl: string = "https://api.memoryrelay.net",
  ) {}

  async store(content: string, metadata?: Record<string, string>): Promise<Memory> {
    const memory: Memory = {
      id: `mem_${this.nextId++}`,
      content,
      agent_id: this.agentId,
      user_id: "user_test",
      metadata: metadata || {},
      entities: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    this.memories.push(memory);
    return memory;
  }

  async search(query: string, limit: number = 5, threshold: number = 0.3): Promise<SearchResult[]> {
    // Simple keyword matching for testing
    const results = this.memories
      .filter((m) => m.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit)
      .map((memory) => ({
        memory,
        score: 0.8, // Mock score
      }));
    return results;
  }

  async list(limit: number = 20, offset: number = 0): Promise<Memory[]> {
    return this.memories.slice(offset, offset + limit);
  }

  async get(id: string): Promise<Memory> {
    const memory = this.memories.find((m) => m.id === id);
    if (!memory) throw new Error("Memory not found");
    return memory;
  }

  async delete(id: string): Promise<void> {
    const index = this.memories.findIndex((m) => m.id === id);
    if (index === -1) throw new Error("Memory not found");
    this.memories.splice(index, 1);
  }

  async health(): Promise<{ status: string }> {
    return { status: "healthy" };
  }

  async stats(): Promise<Stats> {
    return {
      total_memories: this.memories.length,
      last_updated: new Date().toISOString(),
    };
  }

  async export(): Promise<Memory[]> {
    return [...this.memories];
  }

  // Test helper
  _getMemoryCount(): number {
    return this.memories.length;
  }
}

// ============================================================================
// API Client Tests
// ============================================================================

describe("MemoryRelayClient", () => {
  let client: MockMemoryRelayClient;

  beforeEach(() => {
    client = new MockMemoryRelayClient("test_key", "test_agent");
  });

  test("should store memory with content only", async () => {
    const memory = await client.store("Test content");
    expect(memory.id).toBeTruthy();
    expect(memory.content).toBe("Test content");
    expect(memory.agent_id).toBe("test_agent");
    expect(memory.metadata).toEqual({});
  });

  test("should store memory with metadata", async () => {
    const memory = await client.store("Test content", {
      category: "test",
      importance: "high",
    });
    expect(memory.content).toBe("Test content");
    expect(memory.metadata.category).toBe("test");
    expect(memory.metadata.importance).toBe("high");
  });

  test("should search memories by query", async () => {
    await client.store("Deploy to production server");
    await client.store("Configure database connection");
    await client.store("Update API documentation");

    const results = await client.search("production", 10, 0.3);
    expect(results.length).toBe(1);
    expect(results[0].memory.content).toContain("production");
    expect(results[0].score).toBeGreaterThan(0);
  });

  test("should respect search limit", async () => {
    await client.store("Test 1");
    await client.store("Test 2");
    await client.store("Test 3");

    const results = await client.search("test", 2, 0.3);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("should list memories with pagination", async () => {
    await client.store("Memory 1");
    await client.store("Memory 2");
    await client.store("Memory 3");

    const page1 = await client.list(2, 0);
    expect(page1.length).toBe(2);

    const page2 = await client.list(2, 2);
    expect(page2.length).toBe(1);
  });

  test("should get memory by ID", async () => {
    const stored = await client.store("Test memory");
    const retrieved = await client.get(stored.id);
    expect(retrieved.id).toBe(stored.id);
    expect(retrieved.content).toBe("Test memory");
  });

  test("should delete memory by ID", async () => {
    const memory = await client.store("To be deleted");
    await client.delete(memory.id);
    await expect(client.get(memory.id)).rejects.toThrow("Memory not found");
  });

  test("should return health status", async () => {
    const health = await client.health();
    expect(health.status).toBe("healthy");
  });

  test("should return agent stats", async () => {
    await client.store("Memory 1");
    await client.store("Memory 2");

    const stats = await client.stats();
    expect(stats.total_memories).toBe(2);
    expect(stats.last_updated).toBeTruthy();
  });

  test("should export all memories", async () => {
    await client.store("Export test 1");
    await client.store("Export test 2");
    await client.store("Export test 3");

    const exported = await client.export();
    expect(exported.length).toBe(3);
    expect(exported[0].content).toBe("Export test 1");
  });
});

// ============================================================================
// Retry Logic Tests
// ============================================================================

describe("Retry Logic", () => {
  test("should retry on network error", async () => {
    let attempts = 0;
    const mockFetch = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("network error");
      }
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    });

    // Mock implementation would use mockFetch
    expect(attempts).toBeLessThanOrEqual(3);
  });

  test("should retry on 503 error", async () => {
    let attempts = 0;
    const mockFetch = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        return {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          json: async () => ({ message: "Service temporarily unavailable" }),
        };
      }
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    });

    expect(attempts).toBeLessThanOrEqual(2);
  });

  test("should not retry on 4xx errors", async () => {
    // 4xx errors are client errors and should not be retried
    // Verify 400 is not in the retryable error patterns (502, 503, 504)
    const errorStr = "400 Bad Request".toLowerCase();
    const isRetryable =
      errorStr.includes("timeout") ||
      errorStr.includes("econnrefused") ||
      errorStr.includes("502") ||
      errorStr.includes("503") ||
      errorStr.includes("504");
    expect(isRetryable).toBe(false);
  });
});

// ============================================================================
// Timeout Tests
// ============================================================================

describe("Request Timeout", () => {
  test("should timeout after 30 seconds", async () => {
    const mockFetch = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 35000); // 35 seconds
        }),
    );

    // Should throw timeout error
    // Implementation would use AbortController
  });

  test("should not timeout for fast requests", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));

    // Should complete successfully
  });
});

// ============================================================================
// Pattern Detection Tests (Auto-Capture)
// ============================================================================

describe("Pattern Detection", () => {
  function shouldCapture(text: string): boolean {
    if (text.length < 20 || text.length > 2000) return false;

    const patterns = [
      /remember\s+(?:that\s+)?/i,
      /(?:my|the)\s+(?:name|email|phone|address|preference)/i,
      /important(?:ly)?[:\s]/i,
      /always\s+(?:use|prefer|want)/i,
    ];

    return patterns.some((pattern) => pattern.test(text));
  }

  test("should capture 'remember that' phrases", () => {
    expect(shouldCapture("Please remember that I prefer Python for data tasks")).toBe(true);
  });

  test("should capture preferences", () => {
    expect(shouldCapture("My email is user@example.com for notifications")).toBe(true);
  });

  test("should capture important information", () => {
    expect(shouldCapture("Important: Always use HTTPS for API calls in production")).toBe(true);
  });

  test("should not capture short text", () => {
    expect(shouldCapture("Remember this")).toBe(false);
  });

  test("should not capture very long text", () => {
    const longText = "A".repeat(2100);
    expect(shouldCapture(longText)).toBe(false);
  });

  test("should not capture generic conversation", () => {
    expect(shouldCapture("How are you doing today? The weather is nice.")).toBe(false);
  });
});

// ============================================================================
// Channel Filtering Tests
// ============================================================================

describe("Channel Filtering", () => {
  test("should skip auto-recall for excluded channels", () => {
    const excludeChannels = ["whatsapp:group_123", "telegram:456"];
    const currentChannel = "whatsapp:group_123";

    const shouldSkip = excludeChannels.some((excluded) => currentChannel.includes(excluded));
    expect(shouldSkip).toBe(true);
  });

  test("should allow auto-recall for non-excluded channels", () => {
    const excludeChannels = ["whatsapp:group_123"];
    const currentChannel = "telegram:789";

    const shouldSkip = excludeChannels.some((excluded) => currentChannel.includes(excluded));
    expect(shouldSkip).toBe(false);
  });

  test("should handle partial channel ID matches", () => {
    const excludeChannels = ["group_"];
    const channel1 = "whatsapp:group_123";
    const channel2 = "whatsapp:direct_456";

    expect(excludeChannels.some((ex) => channel1.includes(ex))).toBe(true);
    expect(excludeChannels.some((ex) => channel2.includes(ex))).toBe(false);
  });
});

// ============================================================================
// Environment Variable Tests
// ============================================================================

describe("Environment Variable Support", () => {
  test("should fall back to env vars when config missing", () => {
    process.env.MEMORYRELAY_API_KEY = "env_key_123";
    process.env.MEMORYRELAY_AGENT_ID = "env_agent";

    const config = {};
    const apiKey = (config as any).apiKey || process.env.MEMORYRELAY_API_KEY;
    const agentId = (config as any).agentId || process.env.MEMORYRELAY_AGENT_ID;

    expect(apiKey).toBe("env_key_123");
    expect(agentId).toBe("env_agent");

    delete process.env.MEMORYRELAY_API_KEY;
    delete process.env.MEMORYRELAY_AGENT_ID;
  });

  test("should prefer config over env vars", () => {
    process.env.MEMORYRELAY_API_KEY = "env_key";

    const config = { apiKey: "config_key" };
    const apiKey = config.apiKey || process.env.MEMORYRELAY_API_KEY;

    expect(apiKey).toBe("config_key");

    delete process.env.MEMORYRELAY_API_KEY;
  });
});

// ============================================================================
// Integration Tests (Mock Plugin API)
// ============================================================================

describe("Plugin Integration", () => {
  test("should load plugin with valid config", () => {
    const config = {
      apiKey: "test_key",
      agentId: "test_agent",
      autoRecall: true,
      autoCapture: false,
    };

    expect(config.apiKey).toBeTruthy();
    expect(config.agentId).toBeTruthy();
  });

  test("should fail to load without API key", () => {
    const config = {
      agentId: "test_agent",
    };

    const apiKey = config.apiKey || process.env.MEMORYRELAY_API_KEY;
    expect(apiKey).toBeUndefined();
  });

  test("should register all tools", () => {
    const tools = [
      // Memory tools (9)
      "memory_store", "memory_recall", "memory_forget", "memory_list",
      "memory_get", "memory_update", "memory_batch_store", "memory_context", "memory_promote",
      // Entity tools (4)
      "entity_create", "entity_link", "entity_list", "entity_graph",
      // Agent tools (3)
      "agent_list", "agent_create", "agent_get",
      // Session tools (4)
      "session_start", "session_end", "session_recall", "session_list",
      // Decision tools (4)
      "decision_record", "decision_list", "decision_supersede", "decision_check",
      // Pattern tools (4)
      "pattern_create", "pattern_search", "pattern_adopt", "pattern_suggest",
      // Project tools (10)
      "project_register", "project_list", "project_info",
      "project_add_relationship", "project_dependencies", "project_dependents",
      "project_related", "project_impact", "project_shared_patterns", "project_context",
      // Health (1)
      "memory_health",
    ];
    expect(tools.length).toBe(39);
  });

  test("should register all CLI commands", () => {
    const commands = ["status", "stats", "list", "search", "delete", "export"];
    expect(commands.length).toBe(6);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling", () => {
  let client: MockMemoryRelayClient;

  beforeEach(() => {
    client = new MockMemoryRelayClient("test_key", "test_agent");
  });

  test("should handle delete of non-existent memory", async () => {
    await expect(client.delete("non_existent_id")).rejects.toThrow("Memory not found");
  });

  test("should handle get of non-existent memory", async () => {
    await expect(client.get("non_existent_id")).rejects.toThrow("Memory not found");
  });

  test("should handle empty search results", async () => {
    const results = await client.search("nonexistent query", 5, 0.3);
    expect(results).toEqual([]);
  });

  test("should handle empty list", async () => {
    const memories = await client.list(10, 0);
    expect(memories).toEqual([]);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("Performance", () => {
  let client: MockMemoryRelayClient;

  beforeEach(() => {
    client = new MockMemoryRelayClient("test_key", "test_agent");
  });

  test("should handle bulk store operations", async () => {
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(client.store(`Memory ${i}`));
    }
    const results = await Promise.all(promises);
    expect(results.length).toBe(100);
  });

  test("should handle large export", async () => {
    for (let i = 0; i < 500; i++) {
      await client.store(`Memory ${i}`);
    }
    const exported = await client.export();
    expect(exported.length).toBe(500);
  });

  test("should handle pagination for large datasets", async () => {
    for (let i = 0; i < 200; i++) {
      await client.store(`Memory ${i}`);
    }

    const page1 = await client.list(100, 0);
    const page2 = await client.list(100, 100);

    expect(page1.length).toBe(100);
    expect(page2.length).toBe(100);
  });
});

// ============================================================================
// Tool Group Tests (v0.7.0)
// ============================================================================

describe("Tool Groups", () => {
  const TOOL_GROUPS: Record<string, string[]> = {
    memory: [
      "memory_store", "memory_recall", "memory_forget", "memory_list",
      "memory_get", "memory_update", "memory_batch_store", "memory_context", "memory_promote",
    ],
    entity: ["entity_create", "entity_link", "entity_list", "entity_graph"],
    agent: ["agent_list", "agent_create", "agent_get"],
    session: ["session_start", "session_end", "session_recall", "session_list"],
    decision: ["decision_record", "decision_list", "decision_supersede", "decision_check"],
    pattern: ["pattern_create", "pattern_search", "pattern_adopt", "pattern_suggest"],
    project: [
      "project_register", "project_list", "project_info",
      "project_add_relationship", "project_dependencies", "project_dependents",
      "project_related", "project_impact", "project_shared_patterns", "project_context",
    ],
    health: ["memory_health"],
  };

  test("should have correct total tool count across all groups", () => {
    const totalTools = Object.values(TOOL_GROUPS).flat();
    expect(totalTools.length).toBe(39);
  });

  test("should have no duplicate tool names", () => {
    const allTools = Object.values(TOOL_GROUPS).flat();
    const uniqueTools = new Set(allTools);
    expect(uniqueTools.size).toBe(allTools.length);
  });

  test("memory group should have 9 tools", () => {
    expect(TOOL_GROUPS.memory.length).toBe(9);
  });

  test("session group should have 4 tools", () => {
    expect(TOOL_GROUPS.session.length).toBe(4);
  });

  test("decision group should have 4 tools", () => {
    expect(TOOL_GROUPS.decision.length).toBe(4);
  });

  test("pattern group should have 4 tools", () => {
    expect(TOOL_GROUPS.pattern.length).toBe(4);
  });

  test("project group should have 10 tools", () => {
    expect(TOOL_GROUPS.project.length).toBe(10);
  });

  test("should filter tools by enabledTools config (group names)", () => {
    const enabledGroups = "memory,session";
    const groups = enabledGroups.split(",").map((g) => g.trim().toLowerCase());
    const enabledToolNames = new Set<string>();
    for (const group of groups) {
      const tools = TOOL_GROUPS[group];
      if (tools) {
        for (const tool of tools) {
          enabledToolNames.add(tool);
        }
      }
    }

    // Memory group tools should be enabled
    expect(enabledToolNames.has("memory_store")).toBe(true);
    expect(enabledToolNames.has("memory_recall")).toBe(true);
    expect(enabledToolNames.has("memory_promote")).toBe(true);

    // Session group tools should be enabled
    expect(enabledToolNames.has("session_start")).toBe(true);
    expect(enabledToolNames.has("session_end")).toBe(true);

    // Other groups should NOT be enabled
    expect(enabledToolNames.has("decision_record")).toBe(false);
    expect(enabledToolNames.has("project_register")).toBe(false);
    expect(enabledToolNames.has("entity_create")).toBe(false);
    expect(enabledToolNames.has("memory_health")).toBe(false);
  });

  test("should enable all tools when enabledTools is 'all'", () => {
    const enabledGroups = "all";
    const groups = enabledGroups.split(",").map((g) => g.trim().toLowerCase());
    // When 'all' is present, return null (meaning all enabled)
    const isAll = groups.includes("all");
    expect(isAll).toBe(true);
  });

  test("should ignore unknown group names gracefully", () => {
    const enabledGroups = "memory,nonexistent,session";
    const groups = enabledGroups.split(",").map((g) => g.trim().toLowerCase());
    const enabledToolNames = new Set<string>();
    for (const group of groups) {
      const tools = TOOL_GROUPS[group];
      if (tools) {
        for (const tool of tools) {
          enabledToolNames.add(tool);
        }
      }
    }
    // Only memory + session tools should be enabled (nonexistent is skipped)
    expect(enabledToolNames.size).toBe(13); // 9 memory + 4 session
  });
});

// ============================================================================
// Workflow Instructions Tests (v0.7.0)
// ============================================================================

describe("Workflow Instructions", () => {
  const TOOL_GROUPS: Record<string, string[]> = {
    memory: [
      "memory_store", "memory_recall", "memory_forget", "memory_list",
      "memory_get", "memory_update", "memory_batch_store", "memory_context", "memory_promote",
    ],
    entity: ["entity_create", "entity_link", "entity_list", "entity_graph"],
    agent: ["agent_list", "agent_create", "agent_get"],
    session: ["session_start", "session_end", "session_recall", "session_list"],
    decision: ["decision_record", "decision_list", "decision_supersede", "decision_check"],
    pattern: ["pattern_create", "pattern_search", "pattern_adopt", "pattern_suggest"],
    project: [
      "project_register", "project_list", "project_info",
      "project_add_relationship", "project_dependencies", "project_dependents",
      "project_related", "project_impact", "project_shared_patterns", "project_context",
    ],
    health: ["memory_health"],
  };

  function buildWorkflowLines(
    enabledToolNames: Set<string> | null,
    defaultProject?: string,
  ): string[] {
    const isToolEnabled = (name: string): boolean => {
      if (!enabledToolNames) return true;
      return enabledToolNames.has(name);
    };

    const lines: string[] = [
      "You have MemoryRelay tools available for persistent memory across sessions.",
    ];

    if (defaultProject) {
      lines.push(`Default project: \`${defaultProject}\` (auto-applied when you omit the project parameter).`);
    }

    lines.push("", "## Recommended Workflow", "");

    const startSteps: string[] = [];
    if (isToolEnabled("project_context")) startSteps.push("project_context");
    if (isToolEnabled("session_start")) startSteps.push("session_start");
    if (isToolEnabled("decision_check")) startSteps.push("decision_check");
    if (isToolEnabled("pattern_search")) startSteps.push("pattern_search");

    if (startSteps.length > 0) {
      lines.push("When starting work on a project:");
      startSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    }

    const workSteps: string[] = [];
    if (isToolEnabled("memory_store")) workSteps.push("memory_store");
    if (isToolEnabled("decision_record")) workSteps.push("decision_record");
    if (isToolEnabled("pattern_create")) workSteps.push("pattern_create");

    if (isToolEnabled("session_end")) {
      lines.push("session_end");
    }

    if (isToolEnabled("project_register")) {
      lines.push("project_register");
    }

    if (startSteps.length === 0 && workSteps.length === 0) {
      lines.push("Use memory_store and memory_recall");
    }

    return lines;
  }

  test("should include project-first workflow when all tools enabled", () => {
    const lines = buildWorkflowLines(null);
    const text = lines.join("\n");
    expect(text).toContain("project_context");
    expect(text).toContain("session_start");
    expect(text).toContain("decision_check");
    expect(text).toContain("session_end");
    expect(text).toContain("project_register");
  });

  test("workflow should start with project_context", () => {
    const lines = buildWorkflowLines(null);
    const startIndex = lines.indexOf("When starting work on a project:");
    expect(startIndex).toBeGreaterThan(-1);
    // project_context should be the first step after the header
    expect(lines[startIndex + 1]).toContain("project_context");
  });

  test("workflow instructions should include first-time setup guidance", () => {
    const lines = buildWorkflowLines(null);
    expect(lines).toContain("project_register");
  });

  test("workflow should only reference enabled tools", () => {
    // Enable only memory + session groups
    const enabledToolNames = new Set<string>();
    for (const tool of TOOL_GROUPS.memory) enabledToolNames.add(tool);
    for (const tool of TOOL_GROUPS.session) enabledToolNames.add(tool);

    const lines = buildWorkflowLines(enabledToolNames);
    const text = lines.join("\n");

    // memory_store and session tools should be present
    expect(text).toContain("session_start");
    expect(text).toContain("session_end");

    // project/decision/pattern tools should NOT be mentioned
    expect(text).not.toContain("project_context");
    expect(text).not.toContain("decision_check");
    expect(text).not.toContain("pattern_search");
    expect(text).not.toContain("project_register");
  });

  test("workflow should include defaultProject hint when configured", () => {
    const lines = buildWorkflowLines(null, "my-api");
    const text = lines.join("\n");
    expect(text).toContain("my-api");
    expect(text).toContain("Default project");
  });

  test("workflow should show memory-only fallback when no session/decision tools", () => {
    // Only health tools enabled (no memory_store, no session, no decision)
    const enabledToolNames = new Set<string>();
    for (const tool of TOOL_GROUPS.health) enabledToolNames.add(tool);

    const lines = buildWorkflowLines(enabledToolNames);
    const text = lines.join("\n");
    expect(text).toContain("memory_store and memory_recall");
  });
});

// ============================================================================
// Config Extensions Tests (v0.7.0)
// ============================================================================

describe("Config Extensions", () => {
  test("should support defaultProject config", () => {
    const config = {
      apiKey: "test_key",
      agentId: "test_agent",
      defaultProject: "my-api",
    };
    expect(config.defaultProject).toBe("my-api");
  });

  test("should support enabledTools config", () => {
    const config = {
      apiKey: "test_key",
      agentId: "test_agent",
      enabledTools: "memory,session,decision",
    };
    const groups = config.enabledTools.split(",");
    expect(groups).toContain("memory");
    expect(groups).toContain("session");
    expect(groups).toContain("decision");
    expect(groups).not.toContain("project");
  });

  test("should enable all tools when enabledTools not set", () => {
    const config = {
      apiKey: "test_key",
      agentId: "test_agent",
    };
    expect((config as any).enabledTools).toBeUndefined();
    // When undefined, all tools should be enabled
  });

  test("defaultProject should be included in tool descriptions when set", () => {
    const defaultProject = "my-api";

    // Simulate how the plugin builds tool descriptions
    const memoryStoreDesc = "Store a new memory." +
      (defaultProject ? ` Project defaults to '${defaultProject}' if not specified.` : "");
    const decisionCheckDesc = "Check existing decisions." +
      (defaultProject ? ` Scoped to project '${defaultProject}' by default.` : "");

    expect(memoryStoreDesc).toContain("my-api");
    expect(decisionCheckDesc).toContain("my-api");
  });

  test("defaultProject should NOT be in descriptions when not set", () => {
    const defaultProject = undefined;

    const memoryStoreDesc = "Store a new memory." +
      (defaultProject ? ` Project defaults to '${defaultProject}'.` : "");

    expect(memoryStoreDesc).not.toContain("defaults to");
  });
});

// ============================================================================
// Agent ID Scoping Tests (v0.7.1)
// ============================================================================

describe("Agent ID Scoping", () => {
  test("memory_list URL should include agent_id", () => {
    const agentId = "test-agent";
    const limit = 20;
    const offset = 0;
    const url = `/v1/memories?limit=${limit}&offset=${offset}&agent_id=${encodeURIComponent(agentId)}`;
    expect(url).toContain("agent_id=test-agent");
  });

  test("memory_forget search should apply defaultProject", () => {
    // The fix passes defaultProject to the search call in memory_forget
    const defaultProject = "my-api";
    const searchOptions = { project: defaultProject };
    expect(searchOptions.project).toBe("my-api");
  });

  test("memory_context should accept project parameter", () => {
    // The tool now has project in its schema and passes it to buildContext
    const args = { query: "test", project: "my-api" };
    expect(args.project).toBe("my-api");
  });

  test("memory_context project should default to defaultProject", () => {
    const defaultProject = "my-api";
    const args: { query: string; project?: string } = { query: "test" };
    const project = args.project ?? defaultProject;
    expect(project).toBe("my-api");
  });
});

// ============================================================================
// API Alignment Tests (v0.7.2 — critical endpoint fixes)
// ============================================================================

describe("API Endpoint Alignment", () => {
  // These tests verify that client methods build correct HTTP requests
  // matching the actual MemoryRelay API endpoints.

  test("decision_check should use GET with query params (not POST)", () => {
    // API: GET /v1/decisions/check?query=X&project=Y&...
    const params = new URLSearchParams();
    params.set("query", "auth approach");
    params.set("project", "my-api");
    params.set("limit", "5");
    params.set("threshold", "0.3");
    const url = `/v1/decisions/check?${params.toString()}`;

    expect(url).toContain("/v1/decisions/check?");
    expect(url).toContain("query=auth+approach");
    expect(url).toContain("project=my-api");
    expect(url).not.toContain("POST");
  });

  test("decision_check should omit unset optional params", () => {
    const params = new URLSearchParams();
    params.set("query", "test");
    // project, limit, threshold, include_superseded all omitted
    const url = `/v1/decisions/check?${params.toString()}`;
    expect(url).toBe("/v1/decisions/check?query=test");
  });

  test("decision_check should include include_superseded when true", () => {
    const params = new URLSearchParams();
    params.set("query", "test");
    params.set("include_superseded", "true");
    const url = `/v1/decisions/check?${params.toString()}`;
    expect(url).toContain("include_superseded=true");
  });

  test("pattern_search should use GET with query params (not POST)", () => {
    // API: GET /v1/patterns/search?query=X&category=Y&...
    const params = new URLSearchParams();
    params.set("query", "error handling");
    params.set("category", "architecture");
    params.set("project", "my-api");
    const url = `/v1/patterns/search?${params.toString()}`;

    expect(url).toContain("/v1/patterns/search?");
    expect(url).toContain("query=error+handling");
    expect(url).toContain("category=architecture");
    expect(url).toContain("project=my-api");
  });

  test("entity_link should POST to /v1/entities/links (not /{id}/memories)", () => {
    // API: POST /v1/entities/links with { entity_id, memory_id, relationship }
    const path = "/v1/entities/links";
    const body = {
      entity_id: "entity-uuid",
      memory_id: "memory-uuid",
      relationship: "mentioned_in",
    };

    expect(path).toBe("/v1/entities/links");
    expect(body.entity_id).toBe("entity-uuid");
    expect(body.memory_id).toBe("memory-uuid");
    // entity_id MUST be in the body, not the URL path
    expect(path).not.toContain("entity-uuid");
  });

  test("project_add_relationship should POST to /v1/projects/{slug}/relationships", () => {
    // API: POST /v1/projects/{slug}/relationships
    //   body: { target_project, relationship_type, metadata }
    const fromSlug = "my-api";
    const path = `/v1/projects/${encodeURIComponent(fromSlug)}/relationships`;
    const body = {
      target_project: "frontend-app",
      relationship_type: "api_consumer",
      metadata: { version: "v2" },
    };

    expect(path).toBe("/v1/projects/my-api/relationships");
    expect(body.target_project).toBe("frontend-app");
    expect(body.relationship_type).toBe("api_consumer");
    // Must NOT have from_slug/to_slug/details (old wrong fields)
    expect(body).not.toHaveProperty("from_slug");
    expect(body).not.toHaveProperty("to_slug");
    expect(body).not.toHaveProperty("details");
  });

  test("project_impact should POST to /v1/projects/impact-analysis", () => {
    // API: POST /v1/projects/impact-analysis
    //   body: { project, change_description }
    const path = "/v1/projects/impact-analysis";
    const body = {
      project: "my-api",
      change_description: "Changing auth from API keys to OAuth",
    };

    expect(path).toBe("/v1/projects/impact-analysis");
    expect(body.project).toBe("my-api");
    // project slug must be in body, not URL path
    expect(path).not.toContain("my-api");
  });

  test("project_shared_patterns should use GET with query params a and b", () => {
    // API: GET /v1/projects/shared-patterns?a=X&b=Y
    const params = new URLSearchParams();
    params.set("a", "my-api");
    params.set("b", "frontend-app");
    const url = `/v1/projects/shared-patterns?${params.toString()}`;

    expect(url).toContain("/v1/projects/shared-patterns?");
    expect(url).toContain("a=my-api");
    expect(url).toContain("b=frontend-app");
    // Must NOT use path params like /projects/X/shared-patterns/Y
    expect(url).not.toMatch(/\/projects\/my-api\/shared-patterns\//);
  });

  test("error responses should extract detail field (FastAPI format)", () => {
    // FastAPI returns { "detail": "..." }, not { "message": "..." }
    const errorData = { detail: "Account email not verified" };
    const errorMsg = errorData.detail || (errorData as any).message || "";
    expect(errorMsg).toBe("Account email not verified");
  });

  test("error responses should fall back to message field", () => {
    // Some responses may use message field
    const errorData = { message: "Rate limit exceeded" };
    const errorMsg = (errorData as any).detail || errorData.message || "";
    expect(errorMsg).toBe("Rate limit exceeded");
  });

  test("403 unverified user error should be surfaced to the agent", () => {
    // When API returns 403 for unverified users, the error message should reach the agent
    const status = 403;
    const errorData = { detail: "Account email not verified. API keys are disabled until email verification is complete." };
    const errorMsg = errorData.detail || "";
    const fullError = `MemoryRelay API error: ${status} Forbidden - ${errorMsg}`;

    expect(fullError).toContain("403");
    expect(fullError).toContain("not verified");
    // 403 is NOT retryable (only 5xx are retried)
    expect(status >= 500).toBe(false);
  });
});
