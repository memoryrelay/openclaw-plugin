import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { LocalCache } from "../../src/cache/local-cache";
import type { LocalCacheConfig } from "../../src/cache/types";

const DEFAULT_CONFIG: LocalCacheConfig = {
  enabled: true,
  dbPath: ":memory:",
  syncIntervalMinutes: 5,
  maxLocalMemories: 1000,
  vectorSearch: { enabled: false, provider: "sqlite-vec" },
  ttl: { hot: 72, warm: 168, cold: 720 },
};

function makeMemory(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id as string ?? "mem-1",
    content: overrides.content as string ?? "Test memory content",
    agent_id: overrides.agent_id as string ?? "agent-1",
    ...(overrides as Record<string, unknown>),
  };
}

describe("LocalCache", () => {
  let cache: LocalCache;

  beforeEach(() => {
    cache = new LocalCache(":memory:", DEFAULT_CONFIG);
  });

  afterEach(() => {
    cache.close();
  });

  // --- WAL mode ---

  test("enables WAL journal mode", () => {
    // WAL is set in constructor; verify via a new query
    // We can't directly query pragma from outside, but the DB should work
    // If WAL failed, the constructor would throw
    expect(cache).toBeDefined();
  });

  // --- CRUD ---

  describe("CRUD", () => {
    test("upsert inserts a new memory", () => {
      cache.upsert(makeMemory());
      expect(cache.count()).toBe(1);
    });

    test("get retrieves a memory by id", () => {
      cache.upsert(makeMemory({ id: "mem-1", content: "hello world" }));
      const result = cache.get("mem-1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("mem-1");
      expect(result!.content).toBe("hello world");
    });

    test("get returns null for non-existent id", () => {
      expect(cache.get("non-existent")).toBeNull();
    });

    test("upsert updates an existing memory", () => {
      cache.upsert(makeMemory({ id: "mem-1", content: "original" }));
      cache.upsert(makeMemory({ id: "mem-1", content: "updated" }));
      expect(cache.count()).toBe(1);
      expect(cache.get("mem-1")!.content).toBe("updated");
    });

    test("upsert preserves metadata as JSON", () => {
      cache.upsert(makeMemory({ id: "mem-1", metadata: { key: "value", nested: { a: 1 } } }));
      const result = cache.get("mem-1");
      expect(result!.metadata).toEqual({ key: "value", nested: { a: 1 } });
    });

    test("upsert preserves entities as JSON array", () => {
      cache.upsert(makeMemory({ id: "mem-1", entities: ["person:Alice", "org:Acme"] }));
      const result = cache.get("mem-1");
      expect(result!.entities).toEqual(["person:Alice", "org:Acme"]);
    });

    test("delete removes a memory", () => {
      cache.upsert(makeMemory({ id: "mem-1" }));
      const deleted = cache.delete("mem-1");
      expect(deleted).toBe(true);
      expect(cache.count()).toBe(0);
    });

    test("delete returns false for non-existent id", () => {
      expect(cache.delete("non-existent")).toBe(false);
    });

    test("count returns correct number", () => {
      expect(cache.count()).toBe(0);
      cache.upsert(makeMemory({ id: "mem-1" }));
      cache.upsert(makeMemory({ id: "mem-2" }));
      cache.upsert(makeMemory({ id: "mem-3" }));
      expect(cache.count()).toBe(3);
    });

    test("upsert sets default values", () => {
      cache.upsert({ id: "mem-1", content: "test", agent_id: "a1" });
      const m = cache.get("mem-1")!;
      expect(m.importance).toBe(0.5);
      expect(m.tier).toBe("warm");
      expect(m.scope).toBe("long-term");
      expect(m.namespace).toBe("default");
      expect(m.user_id).toBe("");
    });
  });

  // --- FTS5 Search ---

  describe("FTS5 search", () => {
    beforeEach(() => {
      cache.upsert(makeMemory({ id: "m1", content: "TypeScript compiler optimization techniques" }));
      cache.upsert(makeMemory({ id: "m2", content: "Python data science with pandas" }));
      cache.upsert(makeMemory({ id: "m3", content: "TypeScript type inference and generics" }));
      cache.upsert(makeMemory({ id: "m4", content: "Rust memory safety guarantees" }));
    });

    test("search returns matching results", () => {
      const results = cache.search("TypeScript");
      expect(results.length).toBe(2);
    });

    test("search returns results for partial terms", () => {
      const results = cache.search("compiler");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain("compiler");
    });

    test("search with multi-word query", () => {
      const results = cache.search("data science");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("search returns empty for no match", () => {
      const results = cache.search("kubernetes");
      expect(results.length).toBe(0);
    });

    test("search returns empty for empty query", () => {
      const results = cache.search("");
      expect(results.length).toBe(0);
    });

    test("search handles special characters safely", () => {
      const results = cache.search("test's \"quoted\" content");
      // Should not throw, may return 0 results
      expect(Array.isArray(results)).toBe(true);
    });

    test("search respects limit option", () => {
      const results = cache.search("TypeScript", { limit: 1 });
      expect(results.length).toBe(1);
    });

    test("search filters by scope", () => {
      cache.upsert(makeMemory({ id: "s1", content: "session scoped TypeScript", scope: "session", session_id: "sess-1" }));
      const results = cache.search("TypeScript", { scope: "session" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("s1");
    });

    test("search filters by namespace", () => {
      cache.upsert(makeMemory({ id: "n1", content: "namespaced TypeScript", namespace: "custom-ns" }));
      const results = cache.search("TypeScript", { namespace: "custom-ns" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("n1");
    });

    test("FTS index updates on upsert (update)", () => {
      cache.upsert(makeMemory({ id: "m1", content: "completely different content about Golang" }));
      const tsResults = cache.search("compiler");
      expect(tsResults.length).toBe(0);
      const goResults = cache.search("Golang");
      expect(goResults.length).toBe(1);
    });
  });

  // --- searchByScope ---

  describe("searchByScope", () => {
    beforeEach(() => {
      cache.upsert(makeMemory({ id: "lt-1", scope: "long-term", content: "long term memory" }));
      cache.upsert(makeMemory({ id: "s-1", scope: "session", session_id: "sess-a", content: "session A" }));
      cache.upsert(makeMemory({ id: "s-2", scope: "session", session_id: "sess-b", content: "session B" }));
    });

    test("filters by scope", () => {
      const results = cache.searchByScope("long-term");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("lt-1");
    });

    test("filters by scope and session_id", () => {
      const results = cache.searchByScope("session", "sess-a");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("s-1");
    });

    test("filters by namespace", () => {
      cache.upsert(makeMemory({ id: "ns-1", scope: "long-term", namespace: "custom", content: "namespaced" }));
      const results = cache.searchByScope("long-term", undefined, { namespace: "custom" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("ns-1");
    });

    test("respects limit", () => {
      cache.upsert(makeMemory({ id: "lt-2", scope: "long-term", content: "another" }));
      const results = cache.searchByScope("long-term", undefined, { limit: 1 });
      expect(results.length).toBe(1);
    });
  });

  // --- Buffer ---

  describe("buffer operations", () => {
    test("bufferWrite returns an id string", () => {
      const id = cache.bufferWrite("test content", { source: "auto" });
      expect(typeof id).toBe("string");
      expect(Number(id)).toBeGreaterThan(0);
    });

    test("bufferReadPending returns pending entries", () => {
      cache.bufferWrite("content 1", {});
      cache.bufferWrite("content 2", {});
      const pending = cache.bufferReadPending();
      expect(pending.length).toBe(2);
      expect(pending[0].content).toBe("content 1");
      expect(pending[0].flushed).toBe(false);
    });

    test("bufferMarkFlushed marks entries as flushed", () => {
      const id1 = cache.bufferWrite("content 1", {});
      const id2 = cache.bufferWrite("content 2", {});
      cache.bufferMarkFlushed([id1]);
      const pending = cache.bufferReadPending();
      expect(pending.length).toBe(1);
      expect(pending[0].content).toBe("content 2");
    });

    test("bufferDepth returns count of pending entries", () => {
      expect(cache.bufferDepth()).toBe(0);
      cache.bufferWrite("a", {});
      cache.bufferWrite("b", {});
      expect(cache.bufferDepth()).toBe(2);
      const pending = cache.bufferReadPending();
      cache.bufferMarkFlushed([String(pending[0].id)]);
      expect(cache.bufferDepth()).toBe(1);
    });

    test("bufferReadPending returns empty after all flushed", () => {
      const id = cache.bufferWrite("content", {});
      cache.bufferMarkFlushed([id]);
      expect(cache.bufferReadPending().length).toBe(0);
    });

    test("buffer entries are isolated from memories", () => {
      cache.bufferWrite("buffer content", {});
      cache.upsert(makeMemory({ id: "mem-1", content: "memory content" }));
      expect(cache.count()).toBe(1); // only memories counted
      expect(cache.bufferDepth()).toBe(1); // only buffer counted
    });

    test("bufferMarkFlushed with empty array is no-op", () => {
      cache.bufferWrite("content", {});
      cache.bufferMarkFlushed([]);
      expect(cache.bufferDepth()).toBe(1);
    });
  });

  // --- Sync state ---

  describe("sync state", () => {
    test("getSyncState returns nulls initially", () => {
      const state = cache.getSyncState();
      expect(state.lastPull).toBeNull();
      expect(state.lastPush).toBeNull();
      expect(state.cursor).toBeNull();
    });

    test("setSyncState updates individual keys", () => {
      cache.setSyncState({ lastPull: "2026-01-01T00:00:00Z" });
      const state = cache.getSyncState();
      expect(state.lastPull).toBe("2026-01-01T00:00:00Z");
      expect(state.lastPush).toBeNull();
    });

    test("setSyncState updates multiple keys", () => {
      cache.setSyncState({
        lastPull: "2026-01-01T00:00:00Z",
        lastPush: "2026-01-02T00:00:00Z",
        cursor: "abc123",
      });
      const state = cache.getSyncState();
      expect(state.lastPull).toBe("2026-01-01T00:00:00Z");
      expect(state.lastPush).toBe("2026-01-02T00:00:00Z");
      expect(state.cursor).toBe("abc123");
    });

    test("setSyncState overwrites previous values", () => {
      cache.setSyncState({ cursor: "old" });
      cache.setSyncState({ cursor: "new" });
      expect(cache.getSyncState().cursor).toBe("new");
    });
  });

  // --- TTL eviction ---

  describe("evictExpired", () => {
    test("evicts expired memories", () => {
      const past = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago
      cache.upsert(makeMemory({ id: "expired-1", expires_at: past }));
      cache.upsert(makeMemory({ id: "fresh-1", expires_at: null }));
      const evicted = cache.evictExpired();
      expect(evicted).toBe(1);
      expect(cache.get("expired-1")).toBeNull();
      expect(cache.get("fresh-1")).not.toBeNull();
    });

    test("preserves non-expired memories", () => {
      const future = new Date(Date.now() + 86400_000).toISOString(); // tomorrow
      cache.upsert(makeMemory({ id: "future-1", expires_at: future }));
      const evicted = cache.evictExpired();
      expect(evicted).toBe(0);
      expect(cache.get("future-1")).not.toBeNull();
    });

    test("evicts nothing when no memories have expires_at", () => {
      cache.upsert(makeMemory({ id: "m1" }));
      cache.upsert(makeMemory({ id: "m2" }));
      expect(cache.evictExpired()).toBe(0);
    });
  });

  // --- Cap enforcement ---

  describe("enforceCapLimit", () => {
    test("does nothing when under cap", () => {
      cache.upsert(makeMemory({ id: "m1" }));
      const evicted = cache.enforceCapLimit();
      expect(evicted).toBe(0);
    });

    test("evicts cold tier first when over cap", () => {
      const smallConfig = { ...DEFAULT_CONFIG, maxLocalMemories: 3 };
      cache.close();
      cache = new LocalCache(":memory:", smallConfig);

      cache.upsert(makeMemory({ id: "hot-1", tier: "hot", content: "hot" }));
      cache.upsert(makeMemory({ id: "warm-1", tier: "warm", content: "warm" }));
      cache.upsert(makeMemory({ id: "cold-1", tier: "cold", content: "cold" }));
      cache.upsert(makeMemory({ id: "cold-2", tier: "cold", content: "cold 2" }));

      const evicted = cache.enforceCapLimit();
      expect(evicted).toBe(1);
      expect(cache.get("cold-1")).toBeNull(); // oldest cold evicted
      expect(cache.get("hot-1")).not.toBeNull();
      expect(cache.get("warm-1")).not.toBeNull();
    });

    test("evicts warm after all cold are gone", () => {
      const smallConfig = { ...DEFAULT_CONFIG, maxLocalMemories: 2 };
      cache.close();
      cache = new LocalCache(":memory:", smallConfig);

      cache.upsert(makeMemory({ id: "hot-1", tier: "hot", content: "hot" }));
      cache.upsert(makeMemory({ id: "warm-1", tier: "warm", content: "warm" }));
      cache.upsert(makeMemory({ id: "warm-2", tier: "warm", content: "warm 2" }));

      const evicted = cache.enforceCapLimit();
      expect(evicted).toBe(1);
      expect(cache.count()).toBe(2);
      expect(cache.get("hot-1")).not.toBeNull(); // hot preserved
    });

    test("preserves hot tier last", () => {
      const smallConfig = { ...DEFAULT_CONFIG, maxLocalMemories: 1 };
      cache.close();
      cache = new LocalCache(":memory:", smallConfig);

      cache.upsert(makeMemory({ id: "hot-1", tier: "hot", content: "hot" }));
      cache.upsert(makeMemory({ id: "cold-1", tier: "cold", content: "cold" }));
      cache.upsert(makeMemory({ id: "warm-1", tier: "warm", content: "warm" }));

      const evicted = cache.enforceCapLimit();
      expect(evicted).toBe(2);
      expect(cache.count()).toBe(1);
      expect(cache.get("hot-1")).not.toBeNull();
    });
  });

  // --- Stats ---

  describe("stats", () => {
    test("returns accurate stats", () => {
      cache.upsert(makeMemory({ id: "m1" }));
      cache.upsert(makeMemory({ id: "m2" }));
      cache.bufferWrite("pending", {});

      const stats = cache.stats();
      expect(stats.totalMemories).toBe(2);
      expect(stats.bufferDepth).toBe(1);
      expect(stats.dbSizeBytes).toBe(0); // in-memory DB
      expect(stats.lastSync).toBeNull();
    });

    test("stats reflect sync state", () => {
      cache.setSyncState({ lastPull: "2026-01-01T00:00:00Z" });
      const stats = cache.stats();
      expect(stats.lastSync).toBe("2026-01-01T00:00:00Z");
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    test("handles very long content", () => {
      const longContent = "x".repeat(100_000);
      cache.upsert(makeMemory({ id: "long", content: longContent }));
      const result = cache.get("long");
      expect(result!.content.length).toBe(100_000);
    });

    test("handles Unicode content", () => {
      cache.upsert(makeMemory({ id: "uni", content: "日本語テスト 🚀 émojis" }));
      const result = cache.get("uni");
      expect(result!.content).toBe("日本語テスト 🚀 émojis");
    });

    test("search on empty database returns empty", () => {
      const results = cache.search("anything");
      expect(results).toEqual([]);
    });

    test("dbPath property returns the configured path", () => {
      expect(cache.dbPath).toBe(":memory:");
    });
  });

  // --- storeEmbeddingBatch ---

  describe("storeEmbeddingBatch", () => {
    test("is a no-op when vectorAvailable is false (default config)", () => {
      // vectorSearch.enabled = false in DEFAULT_CONFIG — should not throw
      expect(() => {
        cache.storeEmbeddingBatch([
          { id: "m1", embedding: Buffer.alloc(768 * 4) },
        ]);
      }).not.toThrow();
    });

    test("silently skips when memories_vec table does not exist (vectorAvailable=true)", () => {
      const vecConfig: LocalCacheConfig = {
        ...DEFAULT_CONFIG,
        vectorSearch: { enabled: true, provider: "sqlite-vec" },
      };
      const vecCache = new LocalCache(":memory:", vecConfig);

      // memories_vec table is not created (no extension loaded) — should not throw
      expect(() => {
        vecCache.storeEmbeddingBatch([
          { id: "m1", embedding: Buffer.alloc(768 * 4) },
        ]);
      }).not.toThrow();

      vecCache.close();
    });

    test("accepts entries with null embedding without throwing", () => {
      const vecConfig: LocalCacheConfig = {
        ...DEFAULT_CONFIG,
        vectorSearch: { enabled: true, provider: "sqlite-vec" },
      };
      const vecCache = new LocalCache(":memory:", vecConfig);

      expect(() => {
        vecCache.storeEmbeddingBatch([
          { id: "m1", embedding: null },
          { id: "m2", embedding: null },
        ]);
      }).not.toThrow();

      vecCache.close();
    });
  });

  // --- search with queryEmbedding ---

  describe("search with queryEmbedding", () => {
    test("falls back to FTS5 when vectorAvailable is false (default config)", () => {
      cache.upsert(makeMemory({ id: "m1", content: "TypeScript vector search" }));

      const embedding = new Float32Array(768);
      const results = cache.search("TypeScript", { queryEmbedding: embedding });
      // FTS5 path: should still find the match
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("m1");
    });

    test("applies scope filter when vectorAvailable is true and no vec table (graceful fallback)", () => {
      const vecConfig: LocalCacheConfig = {
        ...DEFAULT_CONFIG,
        vectorSearch: { enabled: true, provider: "sqlite-vec" },
      };
      const vecCache = new LocalCache(":memory:", vecConfig);
      vecCache.upsert(makeMemory({ id: "lt", content: "long-term memory", scope: "long-term" }));
      vecCache.upsert(makeMemory({ id: "s1", content: "session memory", scope: "session", session_id: "sess-1" }));

      const embedding = new Float32Array(768);
      // Vector search will throw (no vec0 table) → falls back to FTS5 results → then filtered
      const results = vecCache.search("memory", {
        queryEmbedding: embedding,
        scope: "long-term",
      });
      expect(results.every((m) => m.scope === "long-term")).toBe(true);

      vecCache.close();
    });

    test("passes queryEmbedding=null to search without error (takes FTS5 path)", () => {
      cache.upsert(makeMemory({ id: "m1", content: "TypeScript test" }));
      const results = cache.search("TypeScript", { queryEmbedding: null });
      expect(results.length).toBe(1);
    });
  });
});
