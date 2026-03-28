import type { RecallStage } from "../types.js";

export const recallSearch: RecallStage = {
  name: "search",
  enabled: (ctx) => !!ctx.config.autoRecall,
  execute: async (input, ctx) => {
    const { client } = ctx;
    const { namespace } = ctx.requestCtx;
    const resolvedSessionKey = input.resolvedSessionKey ?? ctx.requestCtx.sessionKey;
    const limit = ctx.config.recallLimit ?? 5;
    const threshold = ctx.config.recallThreshold ?? 0.3;
    const [longTerm, session] = await Promise.all([
      client.search(input.prompt, limit, threshold, { scope: "long-term", namespace }),
      client.search(input.prompt, limit, threshold, { scope: "session", session_id: resolvedSessionKey, namespace }),
    ]);
    return {
      action: "continue",
      data: {
        ...input,
        longTerm: longTerm.map(r => ({ memory: r.memory, finalScore: r.score })),
        session: session.map(r => ({ memory: r.memory, finalScore: r.score })),
      },
    };
  },
};
