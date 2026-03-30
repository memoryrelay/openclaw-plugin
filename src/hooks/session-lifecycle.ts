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
  // Note: session creation is handled by the before_agent_start hook using
  // getOrCreateSession with a deterministic external_id. The session_start
  // hook is intentionally omitted to avoid creating duplicate sessions.

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
