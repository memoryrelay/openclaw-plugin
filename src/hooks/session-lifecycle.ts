// src/hooks/session-lifecycle.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient } from "../pipelines/types.js";
import type { SessionResolver } from "../context/session-resolver.js";

export function registerSessionLifecycle(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  agentId: string,
  defaultProject: string | undefined,
  sessionResolver: SessionResolver,
): void {
  // Session sync: auto-create MemoryRelay session when OpenClaw session starts
  api.on("session_start", async (event, _ctx) => {
    try {
      const externalId = event.sessionKey || event.sessionId;
      if (!externalId) return;

      const response = await client.getOrCreateSession(
        externalId,
        agentId,
        `OpenClaw session ${externalId}`,
        defaultProject || undefined,
        { source: "openclaw-plugin", agent: agentId, trigger: "session_start_hook" },
      );

      api.logger.debug?.(`memory-memoryrelay: auto-created session ${response.id} for OpenClaw session ${externalId}`);
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: session_start hook failed: ${String(err)}`);
    }
  });

  // Session sync: auto-end MemoryRelay session when OpenClaw session ends
  api.on("session_end", async (event, _ctx) => {
    try {
      const externalId = event.sessionKey || event.sessionId;
      if (!externalId) return;

      await sessionResolver.endSession(externalId, `Session ended after ${event.messageCount} messages`);

      api.logger.debug?.(`memory-memoryrelay: auto-ended session for ${externalId}`);
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: session_end hook failed: ${String(err)}`);
    }
  });
}
