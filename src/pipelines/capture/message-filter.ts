import type { CaptureStage } from "../types.js";
import { shouldDropMessage, isAssistantBoilerplate } from "../../filters/noise-patterns.js";

export const captureMessageFilter: CaptureStage = {
  name: "message-filter",
  enabled: () => true,
  execute: async (input, _ctx) => {
    const kept = input.messages.filter(msg => {
      if (shouldDropMessage(msg)) return false;
      if (isAssistantBoilerplate(msg)) return false;
      return true;
    });
    if (kept.length === 0) return { action: "skip" };
    return { action: "continue", data: { messages: kept } };
  },
};
