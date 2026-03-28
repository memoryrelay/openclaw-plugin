import type { CaptureStage } from "../types.js";
import { resolveScope } from "../../filters/content-patterns.js";

export const captureStore: CaptureStage = {
  name: "store",
  enabled: () => true,
  execute: async (input, ctx) => {
    const tier = ctx.config.autoCapture?.tier ?? "smart";
    const maxCapture = tier === "conservative" ? 1 : tier === "aggressive" ? 5 : 3;
    const toStore = input.messages.slice(0, maxCapture);

    // Resolve session UUID for session-scoped storage
    let sessionId: string | undefined;
    if (ctx.sessionResolver) {
      try {
        const entry = await ctx.sessionResolver.resolve(ctx.requestCtx);
        sessionId = entry.sessionId;
      } catch {
        // Continue without session_id if resolution fails
      }
    }

    for (const msg of toStore) {
      const scope = resolveScope(msg.content);
      const opts: Record<string, unknown> = { scope };
      if (scope === "session" && sessionId) {
        opts.session_id = sessionId;
      }
      await ctx.client.store(msg.content, { source: "auto-capture", scope }, opts);
    }
    return { action: "continue", data: input };
  },
};
