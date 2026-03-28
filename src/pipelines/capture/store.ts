import type { CaptureStage } from "../types.js";
import { resolveScope } from "../../filters/content-patterns.js";

export const captureStore: CaptureStage = {
  name: "store",
  enabled: () => true,
  execute: async (input, ctx) => {
    const maxCapture = 3;
    const toStore = input.messages.slice(0, maxCapture);
    for (const msg of toStore) {
      const scope = resolveScope(msg.content);
      await ctx.client.store(msg.content, { source: "auto-capture", scope }, { scope });
    }
    return { action: "continue", data: input };
  },
};
