// src/hooks/agent-end.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient, ConversationMessage, SessionResolverLike } from "../pipelines/types.js";
import { buildRequestContext } from "../context/request-context.js";
import { runPipeline } from "../pipelines/runner.js";
import { capturePipeline } from "../pipelines/capture/index.js";

export function registerAgentEnd(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  sessionResolver?: SessionResolverLike,
): void {
  if (!config.autoCapture?.enabled) return;

  api.on("agent_end", async (event) => {
    if (!event.success || !event.messages || event.messages.length === 0) return;

    try {
      const messages: ConversationMessage[] = [];
      for (const msg of event.messages) {
        if (!msg || typeof msg !== "object") continue;
        const msgObj = msg as Record<string, unknown>;
        const role = msgObj.role as string;
        if (role !== "user" && role !== "assistant") continue;

        const content = msgObj.content;
        if (typeof content === "string") {
          messages.push({ role: role as "user" | "assistant", content });
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object" && (block as any).type === "text" && (block as any).text) {
              messages.push({ role: role as "user" | "assistant", content: (block as any).text });
            }
          }
        }
      }

      if (messages.length === 0) return;

      const requestCtx = buildRequestContext(event, config);
      const pipelineCtx = { requestCtx, config, client, sessionResolver };
      await runPipeline(capturePipeline, { messages }, pipelineCtx);
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: capture failed: ${String(err)}`);
    }
  });
}
