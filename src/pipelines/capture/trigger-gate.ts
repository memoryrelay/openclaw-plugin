import type { CaptureStage } from "../types.js";
import { isNonInteractive } from "../../filters/non-interactive.js";

export const captureTriggerGate: CaptureStage = {
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
    if (ctx.requestCtx.isSubagent) {
      const policy = ctx.config.namespace?.subagentPolicy ?? "inherit";
      if (policy === "skip") { return { action: "skip" }; }
    }
    return { action: "continue", data: input };
  },
};
