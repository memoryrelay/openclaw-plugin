import type { RecallStage } from "../types.js";

export const recallScopeResolver: RecallStage = {
  name: "scope-resolver",
  enabled: () => true,
  execute: async (input, ctx) => {
    const { isSubagent, parentSessionKey, sessionKey } = ctx.requestCtx;
    const policy = ctx.config.namespace?.subagentPolicy ?? "inherit";
    if (isSubagent && policy === "skip") {
      return { action: "skip" };
    }
    const resolvedSessionKey = (isSubagent && policy === "inherit")
      ? parentSessionKey ?? sessionKey
      : sessionKey;
    return {
      action: "continue",
      data: { ...input, resolvedSessionKey },
    };
  },
};
