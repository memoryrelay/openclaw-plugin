// src/hooks/agent-end.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { PluginConfig, MemoryRelayClient, ConversationMessage, LocalCacheLike, SyncDaemonLike } from "../pipelines/types.js";
import { buildRequestContext } from "../context/request-context.js";
import { runPipeline } from "../pipelines/runner.js";
import { capturePipeline } from "../pipelines/capture/index.js";

/** Minimum time between auto-captures per session key (ms) — prevents redundant captures in rapid exchanges */
const CAPTURE_COOLDOWN_MS = 60_000;

/** Per session-key timestamp of last capture (evicted after 2× cooldown to prevent unbounded growth) */
const lastCaptureAt = new Map<string, number>();

// Periodically evict stale entries
const _captureEvictInterval = setInterval(() => {
  const cutoff = Date.now() - CAPTURE_COOLDOWN_MS * 2;
  for (const [key, ts] of lastCaptureAt) {
    if (ts < cutoff) lastCaptureAt.delete(key);
  }
}, 10 * 60_000).unref();
void _captureEvictInterval;

export function registerAgentEnd(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  localCache?: LocalCacheLike,
  syncDaemon?: SyncDaemonLike,
): void {
  api.on("agent_end", async (event) => {
    if (!event.success || !event.messages || event.messages.length === 0) return;

    // Parse messages first (shared by session lifecycle and capture pipeline)
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

    // --- Capture pipeline (only when autoCapture is enabled and quota allows) ---
    if (!config.autoCapture?.enabled) return;

    // Per-session cooldown: skip capture if we captured recently for this session
    const captureSessionKey = event.ctx?.sessionKey || event.sessionId || "default";
    const captureNow = Date.now();
    const lastCapture = lastCaptureAt.get(captureSessionKey) ?? 0;
    if (captureNow - lastCapture < CAPTURE_COOLDOWN_MS) {
      api.logger.debug?.(
        `memory-memoryrelay: skipping capture (cooldown active, ${Math.round((CAPTURE_COOLDOWN_MS - (captureNow - lastCapture)) / 1000)}s remaining)`,
      );
      return;
    }
    lastCaptureAt.set(captureSessionKey, captureNow);

    try {
      const requestCtx = buildRequestContext(event, config);
      const pipelineCtx = { requestCtx, config, client, localCache, syncDaemon };
      await runPipeline(capturePipeline, { messages }, pipelineCtx);
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: capture failed: ${String(err)}`);
    }
  });
}
