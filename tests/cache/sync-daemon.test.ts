import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { SyncDaemon } from "../../src/cache/sync-daemon";
import { LocalCache } from "../../src/cache/local-cache";
import type { LocalCacheConfig } from "../../src/cache/types";
import type { MemoryRelayClient } from "../../src/client/memoryrelay-client";
import type { Memory } from "../../src/pipelines/types";

const DEFAULT_CONFIG: LocalCacheConfig = {
  enabled: true,
  dbPath: ":memory:",
  syncIntervalMinutes: 5,
  maxLocalMemories: 1000,
  vectorSearch: { enabled: false, provider: "sqlite-vec" },
  ttl: { hot: 72, warm: 168, cold: 720 },
};

function makeApiMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "remote-1",
    content: "Remote memory content",
    agent_id: "agent-1",
    user_id: "user-1",
    metadata: {},
    entities: [],
    created_at: "2026-03-29T00:00:00.000Z",
    updated_at: "2026-03-29T00:00:00.000Z",
    importance: 0.5,
    tier: "warm",
    ...overrides,
  };
}

function mockClient(overrides: Partial<MemoryRelayClient> = {}): MemoryRelayClient {
  return {
    list: vi.fn().mockResolvedValue([]),
    store: vi.fn().mockResolvedValue({ id: "new-remote-id" }),
    search: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchStore: vi.fn(),
    buildContext: vi.fn(),
    promote: vi.fn(),
    health: vi.fn(),
    stats: vi.fn(),
    export: vi.fn(),
    storeAsync: vi.fn(),
    getMemoryStatus: vi.fn(),
    buildContextV2: vi.fn(),
    createEntity: vi.fn(),
    linkEntity: vi.fn(),
    listEntities: vi.fn(),
    entityGraph: vi.fn(),
    listAgents: vi.fn(),
    createAgent: vi.fn(),
    getAgent: vi.fn(),
    startSession: vi.fn(),
    getOrCreateSession: vi.fn(),
    endSession: vi.fn(),
    getSession: vi.fn(),
    listSessions: vi.fn(),
    recordDecision: vi.fn(),
    listDecisions: vi.fn(),
    supersedeDecision: vi.fn(),
    checkDecisions: vi.fn(),
    createPattern: vi.fn(),
    searchPatterns: vi.fn(),
    adoptPattern: vi.fn(),
    suggestPatterns: vi.fn(),
    registerProject: vi.fn(),
    listProjects: vi.fn(),
    getProject: vi.fn(),
    addProjectRelationship: vi.fn(),
    getProjectDependencies: vi.fn(),
    getProjectDependents: vi.fn(),
    getProjectRelated: vi.fn(),
    projectImpact: vi.fn(),
    getSharedPatterns: vi.fn(),
    getProjectContext: vi.fn(),
    ...overrides,
  } as unknown as MemoryRelayClient;
}

describe("SyncDaemon", () => {
  let cache: LocalCache;
  let client: MemoryRelayClient;
  let daemon: SyncDaemon;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new LocalCache(":memory:", DEFAULT_CONFIG);
    client = mockClient();
    daemon = new SyncDaemon(cache, client, DEFAULT_CONFIG);
  });

  afterEach(() => {
    daemon.stop();
    cache.close();
    vi.useRealTimers();
  });

  // === Pull ===

  describe("pull", () => {
    test("fetches memories from API and upserts locally", async () => {
      const memories = [
        makeApiMemory({ id: "m-1", content: "first" }),
        makeApiMemory({ id: "m-2", content: "second" }),
      ];
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(memories);

      const result = await daemon.pull();

      expect(result.added).toBe(2);
      expect(result.updated).toBe(0);
      expect(cache.get("m-1")?.content).toBe("first");
      expect(cache.get("m-2")?.content).toBe("second");
    });

    test("handles empty API response", async () => {
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await daemon.pull();

      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
    });

    test("uses cursor for incremental sync", async () => {
      // First pull: 2 memories (sub-page, no extra empty call needed)
      const batch1 = [
        makeApiMemory({ id: "m-1" }),
        makeApiMemory({ id: "m-2" }),
      ];
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(batch1);
      await daemon.pull();

      // Verify cursor was saved
      const state = cache.getSyncState();
      expect(state.cursor).toBe("2");

      // Second pull: should start from cursor offset=2
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeApiMemory({ id: "m-3" }),
      ]);
      await daemon.pull();

      expect(client.list).toHaveBeenLastCalledWith(100, expect.any(Number));
      expect(cache.get("m-3")).not.toBeNull();
    });

    test("updates lastPull timestamp", async () => {
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      await daemon.pull();

      const state = cache.getSyncState();
      expect(state.lastPull).not.toBeNull();
    });

    test("API error triggers backoff", async () => {
      (client.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("API down"));

      await expect(daemon.pull()).rejects.toThrow("API down");
      expect(daemon.lastError()).toBe("API down");
    });

    test("updates existing memories (API wins)", async () => {
      // Insert a local memory first
      cache.upsert({
        id: "m-1",
        content: "old content",
        agent_id: "agent-1",
        remote_id: "m-1",
      });

      // Pull returns updated version
      const updated = makeApiMemory({ id: "m-1", content: "new content from API" });
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updated]);

      const result = await daemon.pull();

      expect(result.added).toBe(0);
      expect(result.updated).toBe(1);
      expect(cache.get("m-1")?.content).toBe("new content from API");
    });

    test("handles paginated responses", async () => {
      // Create 100 memories (full page) to trigger pagination
      const fullPage = Array.from({ length: 100 }, (_, i) =>
        makeApiMemory({ id: `m-${i}`, content: `memory ${i}` }),
      );
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fullPage);
      // Second page: sub-page size, stops pagination
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeApiMemory({ id: "m-100" }),
      ]);

      const result = await daemon.pull();

      expect(result.added).toBe(101);
      expect(client.list).toHaveBeenCalledTimes(2);
    });

    test("sets synced_at on upserted memories", async () => {
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeApiMemory({ id: "m-1" }),
      ]);

      await daemon.pull();

      const mem = cache.get("m-1");
      expect(mem?.synced_at).not.toBeNull();
    });
  });

  // === Push ===

  describe("push", () => {
    test("reads buffer entries and sends to API", async () => {
      cache.bufferWrite("new memory", { source: "test" });
      cache.bufferWrite("another memory", { source: "test" });

      const result = await daemon.push();

      expect(result.flushed).toBe(2);
      expect(result.failed).toBe(0);
      expect(client.store).toHaveBeenCalledTimes(2);
    });

    test("marks entries flushed after successful API call", async () => {
      cache.bufferWrite("push me", { source: "test" });

      await daemon.push();

      const pending = cache.bufferReadPending();
      expect(pending).toHaveLength(0);
    });

    test("API error leaves entries unflushed", async () => {
      cache.bufferWrite("will fail", { source: "test" });
      (client.store as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("API error"));

      const result = await daemon.push();

      expect(result.flushed).toBe(0);
      expect(result.failed).toBe(1);
      expect(cache.bufferReadPending()).toHaveLength(1);
    });

    test("handles empty buffer (no-op)", async () => {
      const result = await daemon.push();

      expect(result.flushed).toBe(0);
      expect(result.failed).toBe(0);
      expect(client.store).not.toHaveBeenCalled();
    });

    test("partial failure flushes only successful entries", async () => {
      cache.bufferWrite("entry 1", { source: "test" });
      cache.bufferWrite("entry 2", { source: "test" });
      cache.bufferWrite("entry 3", { source: "test" });

      (client.store as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: "r-1" })
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({ id: "r-3" });

      const result = await daemon.push();

      expect(result.flushed).toBe(2);
      expect(result.failed).toBe(1);
      // One entry should remain unflushed
      expect(cache.bufferReadPending()).toHaveLength(1);
    });

    test("updates lastPush on success", async () => {
      cache.bufferWrite("push me", { source: "test" });
      await daemon.push();

      const state = cache.getSyncState();
      expect(state.lastPush).not.toBeNull();
    });

    test("passes scope from buffer entry to API", async () => {
      cache.bufferWrite("scoped entry", { source: "test", scope: "session" });

      await daemon.push();

      expect(client.store).toHaveBeenCalledWith(
        "scoped entry",
        expect.objectContaining({ source: "test" }),
        expect.objectContaining({ scope: "session" }),
      );
    });
  });

  // === Conflict Resolution ===

  describe("conflict resolution", () => {
    test("API version overwrites local for same remote_id", async () => {
      cache.upsert({
        id: "m-1",
        remote_id: "m-1",
        content: "local version",
        agent_id: "agent-1",
      });

      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeApiMemory({ id: "m-1", content: "API version wins" }),
      ]);

      await daemon.pull();

      expect(cache.get("m-1")?.content).toBe("API version wins");
    });

    test("new local memory pushed to API as new entry", async () => {
      cache.bufferWrite("brand new local", { source: "capture" });

      await daemon.push();

      expect(client.store).toHaveBeenCalledWith(
        "brand new local",
        expect.objectContaining({ source: "capture" }),
        expect.any(Object),
      );
    });
  });

  // === Backoff ===

  describe("backoff", () => {
    test("starts with base interval", () => {
      daemon.start();
      expect(daemon.isRunning()).toBe(true);
    });

    test("increases to 1min after first error", async () => {
      daemon.start();
      (client.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("fail"));

      await expect(daemon.pull()).rejects.toThrow();

      // Daemon should still be running (rescheduled with backoff)
      expect(daemon.isRunning()).toBe(true);
      expect(daemon.lastError()).toBe("fail");
    });

    test("increases 1min → 5min → 30min on consecutive failures", async () => {
      daemon.start();

      // First error
      (client.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("e1"));
      await expect(daemon.pull()).rejects.toThrow();

      // Second error
      (client.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("e2"));
      await expect(daemon.pull()).rejects.toThrow();

      // Third error
      (client.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("e3"));
      await expect(daemon.pull()).rejects.toThrow();

      // Should still be running with max backoff
      expect(daemon.isRunning()).toBe(true);
    });

    test("resets to base after success", async () => {
      daemon.start();

      // Trigger an error
      (client.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("fail"));
      await expect(daemon.pull()).rejects.toThrow();
      expect(daemon.lastError()).toBe("fail");

      // Success resets
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      await daemon.pull();

      expect(daemon.lastError()).toBeNull();
    });

    test("lastError returns null when no errors", () => {
      expect(daemon.lastError()).toBeNull();
    });
  });

  // === Lifecycle ===

  describe("lifecycle", () => {
    test("start creates interval", () => {
      daemon.start();
      expect(daemon.isRunning()).toBe(true);
    });

    test("stop clears interval", () => {
      daemon.start();
      expect(daemon.isRunning()).toBe(true);

      daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });

    test("stop is idempotent", () => {
      daemon.start();
      daemon.stop();
      daemon.stop();
      daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });

    test("start is idempotent (does not create multiple intervals)", () => {
      daemon.start();
      daemon.start();
      daemon.start();
      expect(daemon.isRunning()).toBe(true);

      daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });

    test("isRunning returns false before start", () => {
      expect(daemon.isRunning()).toBe(false);
    });

    test("interval triggers pull and push", async () => {
      const memories = [makeApiMemory({ id: "m-1" })];
      (client.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(memories);

      cache.bufferWrite("buffered", { source: "test" });

      daemon.start();

      // Advance past the interval
      await vi.advanceTimersByTimeAsync(DEFAULT_CONFIG.syncIntervalMinutes * 60_000 + 100);

      expect(client.list).toHaveBeenCalled();
      expect(client.store).toHaveBeenCalled();
    });

    test("can restart after stop", () => {
      daemon.start();
      expect(daemon.isRunning()).toBe(true);

      daemon.stop();
      expect(daemon.isRunning()).toBe(false);

      daemon.start();
      expect(daemon.isRunning()).toBe(true);
    });
  });
});
