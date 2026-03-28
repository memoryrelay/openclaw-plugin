import type { CaptureStage } from "../types.js";

export const captureTruncate: CaptureStage = {
  name: "truncate",
  enabled: () => true,
  execute: async (input, ctx) => {
    const maxLength = ctx.config.autoCapture?.maxMessageLength ?? 2000;
    const truncated = input.messages.map(msg => ({
      ...msg,
      content: msg.content.length > maxLength
        ? msg.content.slice(0, maxLength) + "\u2026"
        : msg.content,
    }));
    return { action: "continue", data: { messages: truncated } };
  },
};
