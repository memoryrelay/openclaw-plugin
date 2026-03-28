import type { CaptureStage } from "../types.js";
import { stripContent } from "../../filters/content-patterns.js";

export const captureContentStrip: CaptureStage = {
  name: "content-strip",
  enabled: () => true,
  execute: async (input, _ctx) => {
    const cleaned = input.messages
      .map(msg => ({ ...msg, content: stripContent(msg.content) }))
      .filter(msg => msg.content.length >= 10);
    if (cleaned.length === 0) return { action: "skip" };
    return { action: "continue", data: { messages: cleaned } };
  },
};
