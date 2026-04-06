// src/hooks/before-prompt-build.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient, SessionResolverLike, LocalCacheLike, SyncDaemonLike, EmbeddingService } from "../pipelines/types.js";
import { buildRequestContext } from "../context/request-context.js";
import { runPipeline } from "../pipelines/runner.js";
import { recallPipeline } from "../pipelines/recall/index.js";

/** Minimum prompt length to trigger recall — avoids burning API quota on "ok", "yes", "thanks" */
const MIN_RECALL_PROMPT_LENGTH = 20;

/** Minimum time between recall calls per session key (ms) — prevents redundant API calls in rapid exchanges */
const RECALL_COOLDOWN_MS = 30_000;

/** Per session-key timestamp of last recall */
const lastRecallAt = new Map<string, number>();

export function registerBeforePromptBuild(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  sessionResolver?: SessionResolverLike,
  localCache?: LocalCacheLike,
  syncDaemon?: SyncDaemonLike,
  embeddingService?: EmbeddingService,
): void {
  api.on("before_prompt_build", async (event) => {
    if (!config.autoRecall) return;

    // Skip very short prompts (greetings, single-word replies, etc.)
    if (!event.prompt || event.prompt.length < MIN_RECALL_PROMPT_LENGTH) return;

    // Check if current channel is excluded
    if (config.excludeChannels && event.channel) {
      const channelId = String(event.channel);
      if (config.excludeChannels.some((excluded: string) => channelId.includes(excluded))) {
        api.logger.debug?.(
          `memory-memoryrelay: skipping recall for excluded channel: ${channelId}`,
        );
        return;
      }
    }

    // Per-session cooldown: skip recall if we just ran one recently
    const sessionKey = event.ctx?.sessionKey || event.sessionId || "default";
    const now = Date.now();
    const lastRecall = lastRecallAt.get(sessionKey) ?? 0;
    if (now - lastRecall < RECALL_COOLDOWN_MS) {
      api.logger.debug?.(
        `memory-memoryrelay: skipping recall (cooldown active, ${Math.round((RECALL_COOLDOWN_MS - (now - lastRecall)) / 1000)}s remaining)`,
      );
      return;
    }
    lastRecallAt.set(sessionKey, now);

    try {
      const requestCtx = buildRequestContext(event, config);
      const pipelineCtx = { requestCtx, config, client, sessionResolver, localCache, syncDaemon, embeddingService };
      const result = await runPipeline(recallPipeline, {
        prompt: requestCtx.prompt, memories: [], scope: "all" as const,
      }, pipelineCtx);

      if (!result || !result.formatted) return;

      api.logger.info?.(`memory-memoryrelay: injecting memories into context`);

      return { prependContext: result.formatted };
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: recall failed: ${String(err)}`);
    }
  });
}
