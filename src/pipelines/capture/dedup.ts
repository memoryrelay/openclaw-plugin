import type { CaptureStage } from "../types.js";

export const captureDedup: CaptureStage = {
  name: "dedup",
  enabled: () => true,
  execute: async (input, ctx) => {
    const kept = [];
    for (const msg of input.messages) {
      const existing = await ctx.client.search(msg.content, 1, 0.95, {
        namespace: ctx.requestCtx.namespace,
      });
      if (existing.length === 0) { kept.push(msg); }
    }
    if (kept.length === 0) return { action: "skip" };
    return { action: "continue", data: { messages: kept } };
  },
};
