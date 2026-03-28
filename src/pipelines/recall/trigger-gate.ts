import type { RecallStage } from "../types.js";
import { isNonInteractive } from "../../filters/non-interactive.js";

export const recallTriggerGate: RecallStage = {
  name: "trigger-gate",
  enabled: () => true,
  execute: async (input, ctx) => {
    if (isNonInteractive({
      trigger: ctx.requestCtx.trigger,
      sessionKey: ctx.requestCtx.sessionKey,
      prompt: ctx.requestCtx.prompt,
    })) {
      return { action: "skip" };
    }
    return { action: "continue", data: input };
  },
};
