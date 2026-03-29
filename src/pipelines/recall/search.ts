import type { RecallStage, ScoredMemory } from "../types.js";

function isCacheStale(lastPull: string | null, syncIntervalMinutes: number): boolean {
  if (!lastPull) return true;
  const lastPullTime = new Date(lastPull).getTime();
  if (isNaN(lastPullTime)) return true;
  const staleAfterMs = syncIntervalMinutes * 60 * 1000;
  return Date.now() - lastPullTime > staleAfterMs;
}

export const recallSearch: RecallStage = {
  name: "search",
  enabled: (ctx) => !!ctx.config.autoRecall,
  execute: async (input, ctx) => {
    const { client } = ctx;
    const { namespace } = ctx.requestCtx;
    const resolvedSessionKey = input.resolvedSessionKey ?? ctx.requestCtx.sessionKey;
    const limit = ctx.config.recallLimit ?? 5;
    const threshold = ctx.config.recallThreshold ?? 0.3;

    // Resolve session key to MemoryRelay session UUID
    let sessionId: string | undefined;
    if (ctx.sessionResolver) {
      try {
        const entry = await ctx.sessionResolver.resolve({
          ...ctx.requestCtx,
          sessionKey: resolvedSessionKey,
        });
        sessionId = entry.sessionId;
      } catch {
        sessionId = resolvedSessionKey;
      }
    } else {
      sessionId = resolvedSessionKey;
    }

    // Local-first search: try local cache before API
    if (ctx.localCache) {
      try {
        const localCount = ctx.localCache.count();
        if (localCount > 0) {
          const localLongTerm = ctx.localCache.search(input.prompt, {
            limit,
            scope: "long-term",
            namespace,
          });
          const localSession = ctx.localCache.search(input.prompt, {
            limit,
            scope: "session",
            sessionId,
            namespace,
          });

          if (localLongTerm.length > 0 || localSession.length > 0) {
            // Trigger background refresh if stale
            if (ctx.syncDaemon) {
              const syncIntervalMinutes = ctx.config.syncIntervalMinutes ?? 5;
              const syncState = ctx.localCache.getSyncState();
              if (isCacheStale(syncState.lastPull, syncIntervalMinutes)) {
                ctx.syncDaemon.pull().catch(() => {});
              }
            }

            return {
              action: "continue",
              data: {
                ...input,
                longTerm: localLongTerm.map((m) => ({
                  memory: {
                    id: m.id,
                    content: m.content,
                    agent_id: m.agent_id,
                    user_id: m.user_id,
                    metadata: m.metadata as Record<string, string>,
                    entities: m.entities as string[],
                    created_at: m.created_at,
                    updated_at: m.updated_at,
                    importance: m.importance,
                    tier: m.tier,
                  },
                  finalScore: m.importance ?? 0.5,
                })) as ScoredMemory[],
                session: localSession.map((m) => ({
                  memory: {
                    id: m.id,
                    content: m.content,
                    agent_id: m.agent_id,
                    user_id: m.user_id,
                    metadata: m.metadata as Record<string, string>,
                    entities: m.entities as string[],
                    created_at: m.created_at,
                    updated_at: m.updated_at,
                    importance: m.importance,
                    tier: m.tier,
                  },
                  finalScore: m.importance ?? 0.5,
                })) as ScoredMemory[],
                source: "local" as const,
              },
            };
          }
        }
      } catch {
        // Graceful degradation: fall through to API search
      }
    }

    // Fallback: API search
    const [longTerm, session] = await Promise.all([
      client.search(input.prompt, limit, threshold, { scope: "long-term", namespace }),
      client.search(input.prompt, limit, threshold, { scope: "session", session_id: sessionId, namespace }),
    ]);
    return {
      action: "continue",
      data: {
        ...input,
        longTerm: longTerm.map(r => ({ memory: r.memory, finalScore: r.score })),
        session: session.map(r => ({ memory: r.memory, finalScore: r.score })),
        source: "api" as const,
      },
    };
  },
};
