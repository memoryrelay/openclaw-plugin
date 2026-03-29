import type { LocalCache } from "./local-cache.js";
import type { SyncDaemon } from "./sync-daemon.js";
import type { CacheStats, LocalCacheConfig } from "./types.js";

/**
 * MemoryProviderStatus — compatible with OpenClaw's MemorySearchManager interface.
 * See: /usr/lib/node_modules/openclaw/dist/memory-search-B5CuuJZB.js
 */
export interface MemoryProviderStatus {
  backend: "builtin" | "qmd";
  provider: string;
  files?: number;
  chunks?: number;
  dirty?: boolean;
  fts?: { enabled: boolean; available: boolean };
  vector?: { enabled: boolean; available?: boolean; dims?: number };
  cache?: { enabled: boolean; entries?: number; maxEntries?: number };
  custom?: Record<string, unknown>;
}

/**
 * PluginMemoryManager wraps LocalCache + SyncDaemon to satisfy OpenClaw's
 * MemorySearchManager interface, enabling `openclaw status` to display
 * real memory counts and provider info.
 */
export class PluginMemoryManager {
  private readonly cache: LocalCache;
  private readonly syncDaemon: SyncDaemon;
  private readonly vectorAvailable: boolean;
  private readonly config: LocalCacheConfig;
  private readonly agentId: string;

  constructor(
    cache: LocalCache,
    syncDaemon: SyncDaemon,
    config: LocalCacheConfig,
    vectorAvailable: boolean,
    agentId: string,
  ) {
    this.cache = cache;
    this.syncDaemon = syncDaemon;
    this.config = config;
    this.vectorAvailable = vectorAvailable;
    this.agentId = agentId;
  }

  status(): MemoryProviderStatus {
    const stats = this.cache.stats();
    return {
      backend: "builtin",
      provider: "memoryrelay",
      files: stats.totalMemories,
      chunks: stats.totalMemories,
      dirty: stats.bufferDepth > 0,
      fts: { enabled: true, available: true },
      vector: {
        enabled: this.vectorAvailable,
        available: this.vectorAvailable,
        dims: 768,
      },
      cache: {
        enabled: true,
        entries: stats.totalMemories,
        maxEntries: this.config.maxLocalMemories,
      },
      custom: {
        provider: "memoryrelay-api",
        agentId: this.agentId,
        bufferDepth: stats.bufferDepth,
        tierBreakdown: stats.tierBreakdown,
        lastSync: stats.lastSync,
        syncActive: this.syncDaemon.isRunning(),
        consecutiveErrors: this.syncDaemon.getConsecutiveErrors(),
        syncIntervalMinutes: this.config.syncIntervalMinutes,
      },
    };
  }

  cacheStats(): CacheStats {
    return this.cache.stats();
  }

  getSyncDaemonInfo(): { running: boolean; errors: number; intervalMinutes: number; lastError: string | null } {
    return {
      running: this.syncDaemon.isRunning(),
      errors: this.syncDaemon.getConsecutiveErrors(),
      intervalMinutes: this.config.syncIntervalMinutes,
      lastError: this.syncDaemon.lastError(),
    };
  }

  async probeVectorAvailability(): Promise<boolean> {
    return this.vectorAvailable;
  }

  async close(): Promise<void> {
    this.syncDaemon.stop();
    this.cache.close();
  }
}
