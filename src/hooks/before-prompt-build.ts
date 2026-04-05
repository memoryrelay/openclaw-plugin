// src/hooks/before-prompt-build.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient, SessionResolverLike, LocalCacheLike, SyncDaemonLike, EmbeddingService } from "../pipelines/types.js";
import { buildRequestContext } from "../context/request-context.js";
import { runPipeline } from "../pipelines/runner.js";
import { recallPipeline } from "../pipelines/recall/index.js";

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

    if (!event.prompt || event.prompt.length < 10) return;

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
