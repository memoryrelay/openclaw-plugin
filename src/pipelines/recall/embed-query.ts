import type { RecallStage } from "../types.js";

/**
 * recallEmbedQuery — Stage 3 of the recall pipeline.
 *
 * Generates a query embedding for hybrid (FTS5 + vector) search when
 * `vectorSearch.enabled` is true and an `embeddingService` is present in
 * the pipeline context. Failures are silent: the stage sets
 * `queryEmbedding = null` so the downstream search stage falls back to
 * FTS5-only retrieval.
 *
 * Expected latency: ~5 ms on CPU (Nomic ONNX 768-dim model).
 * Gate with `localCache.vectorSearch.enabled = false` in config to skip.
 */
export const recallEmbedQuery: RecallStage = {
  name: "embedQuery",
  enabled: (ctx) => !!(ctx.config.vectorSearch?.enabled),
  execute: async (input, ctx) => {
    if (!ctx.embeddingService) {
      return { action: "continue", data: input };
    }
    try {
      const queryEmbedding = await ctx.embeddingService.generateQuery(input.prompt);
      return { action: "continue", data: { ...input, queryEmbedding } };
    } catch {
      return { action: "continue", data: { ...input, queryEmbedding: null } };
    }
  },
};
