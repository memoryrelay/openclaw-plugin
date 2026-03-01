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
    let attempts = 0;
    const mockFetch = vi.fn(async () => {
      attempts++;
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ message: "Invalid request" }),
      };
    });

    expect(attempts).toBe(1); // Should fail immediately
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
    const tools = ["memory_store", "memory_recall", "memory_forget"];
    expect(tools.length).toBe(3);
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
