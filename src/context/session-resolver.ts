// src/context/session-resolver.ts
import type { MemoryRelayClient, PluginConfig, RequestContext } from "../pipelines/types.js";

export interface SessionEntry {
  readonly sessionId: string;
  readonly externalId: string;
  readonly createdAt: number;
  lastActivityAt: number;
}

export class SessionResolver {
  private readonly cache = new Map<string, SessionEntry>();
  private readonly pending = new Map<string, Promise<SessionEntry>>();
  private readonly client: MemoryRelayClient;
  private readonly timeoutMs: number;

  constructor(client: MemoryRelayClient, config: PluginConfig) {
    this.client = client;
    this.timeoutMs = (config.sessionTimeoutMinutes ?? 120) * 60_000;
  }

  async resolve(requestCtx: RequestContext): Promise<SessionEntry> {
    const key = requestCtx.sessionKey;
    const cached = this.cache.get(key);
    if (cached && !this.isStale(cached)) {
      cached.lastActivityAt = Date.now();
      return cached;
    }
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const promise = this.createSession(requestCtx);
    this.pending.set(key, promise);
    try {
      const entry = await promise;
      this.cache.set(key, entry);
      return entry;
    } finally {
      this.pending.delete(key);
    }
  }

  private async createSession(ctx: RequestContext): Promise<SessionEntry> {
    const result = await this.client.getOrCreateSession(
      ctx.sessionKey,
      ctx.agentId ?? undefined,
      undefined,
      undefined,
      { namespace: ctx.namespace },
    );
    return {
      sessionId: result.id,
      externalId: ctx.sessionKey,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  private isStale(entry: SessionEntry): boolean {
    return (Date.now() - entry.lastActivityAt) > this.timeoutMs;
  }

  async endSession(key: string, summary?: string): Promise<void> {
    const entry = this.cache.get(key);
    if (entry) {
      await this.client.endSession(entry.sessionId, summary);
      this.cache.delete(key);
    }
  }

  async cleanupStale(): Promise<void> {
    for (const [key, entry] of this.cache) {
      if (this.isStale(entry)) {
        await this.endSession(key).catch(() => {});
      }
    }
  }
}
