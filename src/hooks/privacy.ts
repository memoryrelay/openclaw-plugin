// src/hooks/privacy.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export function registerPrivacyHooks(
  api: OpenClawPluginApi,
  blocklist: string[],
  isBlocklisted: (content: string, blocklist: string[]) => boolean,
  redactSensitive: (content: string, blocklist: string[]) => string,
): void {
  api.on("before_message_write", (event, _ctx) => {
    if (blocklist.length === 0) return;

    const msg = event.message;
    if (!msg || typeof msg !== "object") return;

    const m = msg as Record<string, unknown>;
    if (typeof m.content === "string" && isBlocklisted(m.content, blocklist)) {
      return {
        message: {
          ...msg,
          content: redactSensitive(m.content as string, blocklist),
        } as typeof msg,
      };
    }
  });

  // Tool result redaction: apply privacy blocklist before persistence
  api.on("tool_result_persist", (event, _ctx) => {
    if (blocklist.length === 0) return;

    const msg = event.message;
    if (!msg || typeof msg !== "object") return;

    const m = msg as Record<string, unknown>;
    if (typeof m.content === "string" && isBlocklisted(m.content, blocklist)) {
      return {
        message: {
          ...msg,
          content: redactSensitive(m.content as string, blocklist),
        } as typeof msg,
      };
    }
  });
}
