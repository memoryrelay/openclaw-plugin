// src/hooks/subagent.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient } from "../pipelines/types.js";

export interface AutoCaptureConfig {
  enabled: boolean;
  tier: string;
  blocklist?: string[];
}

export function registerSubagentHooks(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  agentId: string,
  autoCaptureConfig: AutoCaptureConfig,
  isBlocklisted: (content: string, blocklist: string[]) => boolean,
): void {
  api.on("subagent_spawned", async (event, _ctx) => {
    try {
      api.logger.debug?.(
        `memory-memoryrelay: subagent spawned: ${event.agentId} (session: ${event.childSessionKey}, label: ${event.label || "none"})`
      );
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: subagent_spawned hook failed: ${String(err)}`);
    }
  });

  api.on("subagent_ended", async (event, _ctx) => {
    try {
      const outcome = event.outcome || "unknown";
      const summary = `Subagent ${event.targetSessionKey} ended: ${event.reason} (outcome: ${outcome})`;

      // Only store subagent completions if autoCapture is enabled and content passes filters (#44)
      if (autoCaptureConfig.enabled) {
        if (isBlocklisted(summary, autoCaptureConfig.blocklist || [])) {
          api.logger.debug?.(`memory-memoryrelay: subagent completion blocklisted, skipping storage`);
          return;
        }

        // Skip routine completion events — only store failures or unusual outcomes
        if (outcome === "ok" || outcome === "success") {
          api.logger.debug?.(`memory-memoryrelay: skipping routine subagent completion: ${summary}`);
          return;
        }

        await client.store(summary, {
          category: "subagent-activity",
          source: "subagent_ended_hook",
          agent: agentId,
          outcome,
        });

        api.logger.debug?.(`memory-memoryrelay: stored subagent completion: ${summary}`);
      } else {
        api.logger.debug?.(`memory-memoryrelay: autoCapture disabled, skipping subagent completion storage`);
      }
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: subagent_ended hook failed: ${String(err)}`);
    }
  });
}
