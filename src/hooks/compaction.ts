// src/hooks/compaction.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { MemoryRelayClient } from "../pipelines/types.js";

export function registerCompactionHooks(
  api: OpenClawPluginApi,
  client: MemoryRelayClient,
  agentId: string,
  blocklist: string[],
  extractRescueContent: (messages: unknown[], blocklist: string[]) => string[],
): void {
  // Compaction rescue: save key context before it's lost
  api.on("before_compaction", async (event, _ctx) => {
    if (!event.messages || event.messages.length === 0) return;
    try {
      const rescued = extractRescueContent(event.messages, blocklist);
      for (const content of rescued) {
        await client.store(content, {
          category: "compaction-rescue",
          source: "auto-compaction",
          agent: agentId,
        });
      }
      if (rescued.length > 0) {
        api.logger.info?.(`memory-memoryrelay: rescued ${rescued.length} memories before compaction`);
      }
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: compaction rescue failed: ${String(err)}`);
    }
  });

  // Session reset rescue: save key context before session is cleared
  api.on("before_reset", async (event, _ctx) => {
    if (!event.messages || event.messages.length === 0) return;
    try {
      const rescued = extractRescueContent(event.messages, blocklist);
      for (const content of rescued) {
        await client.store(content, {
          category: "session-reset-rescue",
          source: "auto-reset",
          agent: agentId,
        });
      }
      if (rescued.length > 0) {
        api.logger.info?.(`memory-memoryrelay: rescued ${rescued.length} memories before reset`);
      }
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: reset rescue failed: ${String(err)}`);
    }
  });
}
