import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { LocalCache } from "../../src/cache/local-cache";
import { SyncDaemon } from "../../src/cache/sync-daemon";
import { PluginMemoryManager } from "../../src/cache/memory-manager";
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
    id: (overrides.id as string) ?? "mem-1",
    content: (overrides.content as string) ?? "Test memory content",
    agent_id: (overrides.agent_id as string) ?? "agent-1",
    ...(overrides as Record<string, unknown>),
  };
}

function createMockSyncDaemon(overrides: Partial<SyncDaemon> = {}): SyncDaemon {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
    lastError: vi.fn().mockReturnValue(null),
    pull: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
    push: vi.fn().mockResolvedValue({ flushed: 0, failed: 0 }),
    ...overrides,
  } as unknown as SyncDaemon;
}

describe("PluginMemoryManager", () => {
  let cache: LocalCache;
  let syncDaemon: SyncDaemon;
  let manager: PluginMemoryManager;

  beforeEach(() => {
    cache = new LocalCache(":memory:", DEFAULT_CONFIG);
    syncDaemon = createMockSyncDaemon();
    manager = new PluginMemoryManager(cache, syncDaemon, DEFAULT_CONFIG, false, "agent-1");
  });

  afterEach(() => {
    cache.close();
  });

  // --- status() ---

  describe("status()", () => {
    test("returns correct backend and provider", () => {
      const status = manager.status();
      expect(status.backend).toBe("builtin");
      expect(status.provider).toBe("memoryrelay");
    });

    test("returns zero files/chunks for empty cache", () => {
      const status = manager.status();
      expect(status.files).toBe(0);
      expect(status.chunks).toBe(0);
    });

    test("returns correct files/chunks count after inserts", () => {
      cache.upsert(makeMemory({ id: "m1" }));
      cache.upsert(makeMemory({ id: "m2" }));
      cache.upsert(makeMemory({ id: "m3" }));
      const status = manager.status();
      expect(status.files).toBe(3);
      expect(status.chunks).toBe(3);
    });

    test("dirty is false when buffer is empty", () => {
      const status = manager.status();
      expect(status.dirty).toBe(false);
    });

    test("dirty is true when buffer has pending entries", () => {
      cache.bufferWrite("pending content", { scope: "long-term" });
      const status = manager.status();
      expect(status.dirty).toBe(true);
    });

    test("fts is enabled and available", () => {
      const status = manager.status();
      expect(status.fts).toEqual({ enabled: true, available: true });
    });

    test("vector is disabled when vectorAvailable is false", () => {
      const status = manager.status();
      expect(status.vector).toEqual({ enabled: false, available: false, dims: 768 });
    });

    test("vector is enabled when vectorAvailable is true", () => {
      const mgr = new PluginMemoryManager(cache, syncDaemon, DEFAULT_CONFIG, true, "agent-1");
      const status = mgr.status();
      expect(status.vector).toEqual({ enabled: true, available: true, dims: 768 });
    });

    test("cache section reports correct entries and maxEntries", () => {
      cache.upsert(makeMemory({ id: "m1" }));
      cache.upsert(makeMemory({ id: "m2" }));
      const status = manager.status();
      expect(status.cache).toEqual({
        enabled: true,
        entries: 2,
        maxEntries: 1000,
      });
    });

    test("custom includes agentId", () => {
      const status = manager.status();
      expect(status.custom?.agentId).toBe("agent-1");
    });

    test("custom includes bufferDepth", () => {
      cache.bufferWrite("buf1", {});
      cache.bufferWrite("buf2", {});
      const status = manager.status();
      expect(status.custom?.bufferDepth).toBe(2);
    });

    test("custom includes syncActive from daemon", () => {
      const status = manager.status();
      expect(status.custom?.syncActive).toBe(true);
    });

    test("custom syncActive is false when daemon not running", () => {
      const stoppedDaemon = createMockSyncDaemon({ isRunning: vi.fn().mockReturnValue(false) as unknown as () => boolean });
      const mgr = new PluginMemoryManager(cache, stoppedDaemon, DEFAULT_CONFIG, false, "agent-1");
      const status = mgr.status();
      expect(status.custom?.syncActive).toBe(false);
    });

    test("custom includes lastSync as null initially", () => {
      const status = manager.status();
      expect(status.custom?.lastSync).toBeNull();
    });
  });

  // --- probeVectorAvailability() ---

  describe("probeVectorAvailability()", () => {
    test("returns false when vector not available", async () => {
      expect(await manager.probeVectorAvailability()).toBe(false);
    });

    test("returns true when vector is available", async () => {
      const mgr = new PluginMemoryManager(cache, syncDaemon, DEFAULT_CONFIG, true, "agent-1");
      expect(await mgr.probeVectorAvailability()).toBe(true);
    });
  });

  // --- close() ---

  describe("close()", () => {
    test("stops sync daemon on close", async () => {
      await manager.close();
      expect(syncDaemon.stop).toHaveBeenCalled();
    });
  });
});
