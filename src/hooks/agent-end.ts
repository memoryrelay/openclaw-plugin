// src/hooks/agent-end.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient, ConversationMessage, SessionResolverLike, LocalCacheLike, SyncDaemonLike } from "../pipelines/types.js";
import { buildRequestContext } from "../context/request-context.js";
import { runPipeline } from "../pipelines/runner.js";
import { capturePipeline } from "../pipelines/capture/index.js";
import { buildAutoSessionExternalId } from "./auto-session-store.js";
import { captureDisabledByQuota } from "./before-agent-start.js";
import { computeSaliencyScore, extractDecisionSentence } from "../saliency/scorer.js";
import type { ScorerOptions } from "../saliency/types.js";

/**
 * Extract potential decisions from conversation messages using multi-signal
 * saliency scoring. Each assistant message is scored; only messages that
 * meet the configured threshold produce a decision record.
 *
 * Returns an array of { title, rationale, confidence, score }.
 */
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

export function extractDecisions(
  messages: ConversationMessage[],
  scorerOptions?: ScorerOptions,
): Array<{ title: string; rationale: string; confidence: "high" | "medium"; score: number }> {
  const decisions: Array<{ title: string; rationale: string; confidence: "high" | "medium"; score: number }> = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;

    const result = computeSaliencyScore(msg.content, messages, scorerOptions);

    if (result.action === "ignore") continue;

    const title = extractDecisionSentence(msg.content, result.signals);
    const key = title.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const signalNames = result.signals
      .filter((s) => s.points > 0)
      .map((s) => s.signal)
      .join(", ");

    decisions.push({
      title,
      rationale: `Auto-detected (score: ${result.score}, confidence: ${result.confidence}, signals: ${signalNames}): ${title}`,
      confidence: result.confidence as "high" | "medium",
      score: result.score,
    });

    if (decisions.length >= 5) break; // Cap at 5 decisions per session
  }
  return decisions;
}

/**
 * Generate a summary from the last few significant assistant messages.
 */
export function generateSessionSummary(messages: ConversationMessage[]): string {
  const assistantMessages = messages
    .filter((m) => m.role === "assistant" && m.content.length > 30)
    .slice(-3);

  if (assistantMessages.length === 0) return "Session completed.";

  return assistantMessages
    .map((m) => m.content.slice(0, 300))
    .join(" | ")
    .slice(0, 800);
}

export function registerAgentEnd(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  sessionResolver?: SessionResolverLike,
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

    // --- Auto session lifecycle: decisions + session_end ---
    // Always close sessions regardless of autoCapture setting to prevent session leak.
    // Only skip if autoSessions is explicitly disabled.
    if (config.autoSessions !== false) {
      const sessionKey = event.ctx?.sessionKey || event.sessionId || "";
      const externalId = buildAutoSessionExternalId(sessionKey);

      // Look up the session via the same deterministic external_id used at start.
      // getOrCreateSession is idempotent — it returns the existing session.
      let sessionId: string | undefined;
      const projectSlug = config.defaultProject || process.env.MEMORYRELAY_DEFAULT_PROJECT;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const session = await client.getOrCreateSession(
          externalId,
          undefined,
          `Auto session ${today}`,
          projectSlug,
          { source: "openclaw-plugin", trigger: "agent_end" },
        );
        sessionId = session?.id;
      } catch (err) {
        api.logger.warn?.(`memory-memoryrelay: auto session lookup failed (non-blocking): ${String(err)}`);
      }

      if (sessionId) {
        try {
          // Extract and record decisions using saliency scoring
          const decisions = extractDecisions(messages);

          for (const decision of decisions) {
            try {
              const tags = ["auto-detected", `confidence:${decision.confidence}`];
              if (decision.confidence === "medium") tags.push("candidate");
              await client.recordDecision(
                decision.title,
                decision.rationale,
                undefined,
                projectSlug,
                tags,
                undefined,
                {
                  source: "auto-session-lifecycle",
                  session_id: sessionId,
                  confidence: decision.confidence,
                  saliency_score: String(decision.score),
                },
              );
            } catch (err) {
              api.logger.warn?.(`memory-memoryrelay: auto decision_record failed: ${String(err)}`);
            }
          }

          // End session with summary
          const summary = generateSessionSummary(messages);
          await client.endSession(sessionId, summary);
          api.logger.debug?.(`memory-memoryrelay: auto-session ended ${sessionId} (external: ${externalId})`);
        } catch (err) {
          api.logger.warn?.(`memory-memoryrelay: auto session_end failed (non-blocking): ${String(err)}`);
        }
      }
    }

    // --- Capture pipeline (only when autoCapture is enabled and quota allows) ---
    if (!config.autoCapture?.enabled || captureDisabledByQuota) return;

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
      const pipelineCtx = { requestCtx, config, client, sessionResolver, localCache, syncDaemon };
      await runPipeline(capturePipeline, { messages }, pipelineCtx);
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: capture failed: ${String(err)}`);
    }
  });
}
