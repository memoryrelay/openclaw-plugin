import type { LocalCache } from "./local-cache.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";
import type { Memory } from "../pipelines/types.js";
import type { LocalCacheConfig } from "./types.js";

// Backoff schedule: consecutiveErrors → interval ms
const BACKOFF_SCHEDULE: Record<number, number> = {
  0: 0, // use base interval
  1: 60_000, // 1 minute
  2: 300_000, // 5 minutes
};
const MAX_BACKOFF_MS = 1_800_000; // 30 minutes

const PULL_PAGE_SIZE = 100;

export class SyncDaemon {
  private readonly cache: LocalCache;
  private readonly client: MemoryRelayClient;
  private readonly config: LocalCacheConfig;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private consecutiveErrors = 0;
  private _lastError: string | null = null;

  constructor(cache: LocalCache, client: MemoryRelayClient, config: LocalCacheConfig) {
    this.cache = cache;
    this.client = client;
    this.config = config;
  }

  start(): void {
    if (this.intervalId !== null) return;

    const baseMs = this.config.syncIntervalMinutes * 60_000;
    this.scheduleNext(baseMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  lastError(): string | null {
    return this._lastError;
  }

  async pull(): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;

    try {
      const syncState = this.cache.getSyncState();
      let offset = syncState.cursor ? parseInt(syncState.cursor, 10) : 0;
      let hasMore = true;

      while (hasMore) {
        const memories: Memory[] = await this.client.list(PULL_PAGE_SIZE, offset);

        if (memories.length === 0) {
          hasMore = false;
          break;
        }

        for (const memory of memories) {
          const existing = this.cache.get(memory.id);
          if (existing) {
            // API wins for edits (same remote_id) — overwrite local
            this.cache.upsert({
              id: memory.id,
              remote_id: memory.id,
              content: memory.content,
              agent_id: memory.agent_id,
              user_id: memory.user_id ?? "",
              metadata: memory.metadata ?? {},
              entities: memory.entities ?? [],
              importance: memory.importance ?? 0.5,
              tier: memory.tier ?? "warm",
              scope: "long-term",
              synced_at: new Date().toISOString(),
              updated_at: memory.updated_at,
              created_at: memory.created_at,
            });
            updated++;
          } else {
            this.cache.upsert({
              id: memory.id,
              remote_id: memory.id,
              content: memory.content,
              agent_id: memory.agent_id,
              user_id: memory.user_id ?? "",
              metadata: memory.metadata ?? {},
              entities: memory.entities ?? [],
              importance: memory.importance ?? 0.5,
              tier: memory.tier ?? "warm",
              scope: "long-term",
              synced_at: new Date().toISOString(),
              updated_at: memory.updated_at,
              created_at: memory.created_at,
            });
            added++;
          }
        }

        offset += memories.length;
        hasMore = memories.length >= PULL_PAGE_SIZE;
      }

      // Update sync state
      this.cache.setSyncState({
        cursor: String(offset),
        lastPull: new Date().toISOString(),
      });

      this.onSuccess();
      return { added, updated };
    } catch (err) {
      this.onError(err);
      throw err;
    }
  }

  async push(): Promise<{ flushed: number; failed: number }> {
    let flushed = 0;
    let failed = 0;

    try {
      const entries = this.cache.bufferReadPending();
      if (entries.length === 0) {
        return { flushed: 0, failed: 0 };
      }

      const flushedIds: string[] = [];

      for (const entry of entries) {
        try {
          await this.client.store(entry.content, entry.metadata as Record<string, string>, {
            scope: entry.scope,
          });
          flushedIds.push(String(entry.id));
          flushed++;
        } catch {
          failed++;
        }
      }

      if (flushedIds.length > 0) {
        this.cache.bufferMarkFlushed(flushedIds);
        this.cache.setSyncState({ lastPush: new Date().toISOString() });
      }

      if (failed === 0) {
        this.onSuccess();
      } else if (flushed === 0) {
        this.onError(new Error(`All ${failed} buffer entries failed to push`));
      }

      return { flushed, failed };
    } catch (err) {
      this.onError(err);
      throw err;
    }
  }

  // --- Internal ---

  private scheduleNext(delayMs: number): void {
    this.intervalId = setInterval(async () => {
      try {
        await this.pull();
        await this.push();
      } catch {
        // errors already handled in pull/push via onError
      }
    }, delayMs);
  }

  private getBackoffMs(): number {
    if (this.consecutiveErrors === 0) {
      return this.config.syncIntervalMinutes * 60_000;
    }
    return BACKOFF_SCHEDULE[this.consecutiveErrors] ?? MAX_BACKOFF_MS;
  }

  private onSuccess(): void {
    if (this.consecutiveErrors > 0) {
      this.consecutiveErrors = 0;
      this._lastError = null;
      this.reschedule();
    }
  }

  private onError(err: unknown): void {
    this.consecutiveErrors++;
    this._lastError = err instanceof Error ? err.message : String(err);
    this.reschedule();
  }

  private reschedule(): void {
    if (this.intervalId === null) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
    const nextMs = this.getBackoffMs();
    this.scheduleNext(nextMs);
  }
}
