import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";

export function registerHealthTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  isToolEnabled: (name: string) => boolean,
): void {

  // --------------------------------------------------------------------------
  // 39. memory_health
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_health")) {
    api.registerTool((ctx) => ({

        name: "memory_health",
        description: "Check the MemoryRelay API connectivity and health status.",
        parameters: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          try {
            const health = await client.health();
            return {
              content: [{ type: "text", text: JSON.stringify(health, null, 2) }],
              details: { health },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Health check failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_health" },
    );
  }
}
