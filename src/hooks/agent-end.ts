// src/hooks/agent-end.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient, ConversationMessage, SessionResolverLike, LocalCacheLike, SyncDaemonLike } from "../pipelines/types.js";
import { buildRequestContext } from "../context/request-context.js";
import { runPipeline } from "../pipelines/runner.js";
import { capturePipeline } from "../pipelines/capture/index.js";
import { autoSessionMap, DECISION_KEYWORDS } from "./auto-session-store.js";

/**
 * Extract potential decisions from conversation messages using keyword heuristics.
 * Returns an array of { title, rationale } for each detected decision.
 */
export function extractDecisions(
  messages: ConversationMessage[],
): Array<{ title: string; rationale: string }> {
  const decisions: Array<{ title: string; rationale: string }> = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    const lower = content.toLowerCase();

    for (const keyword of DECISION_KEYWORDS) {
      if (!lower.includes(keyword)) continue;

      // Find the sentence containing the keyword
      const sentences = content.split(/[.!?\n]+/).filter((s) => s.trim().length > 10);
      for (const sentence of sentences) {
        if (!sentence.toLowerCase().includes(keyword)) continue;
        const trimmed = sentence.trim();
        // Avoid duplicates and very long passages
        if (trimmed.length > 500) continue;
        const key = trimmed.slice(0, 80).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        decisions.push({
          title: trimmed.slice(0, 200),
          rationale: `Auto-detected from conversation (keyword: "${keyword}"): ${trimmed}`,
        });
        break; // One decision per keyword per message
      }
      if (decisions.length >= 5) break; // Cap at 5 decisions per session
    }
    if (decisions.length >= 5) break;
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
  if (!config.autoCapture?.enabled) return;

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
    const sessionKey = event.ctx?.sessionKey || event.sessionId || "";
    const sessionId = autoSessionMap.get(sessionKey);

    if (sessionId) {
      try {
        // Extract and record decisions
        const decisions = extractDecisions(messages);
        const projectSlug = config.defaultProject || process.env.MEMORYRELAY_DEFAULT_PROJECT;

        for (const decision of decisions) {
          try {
            await client.recordDecision(
              decision.title,
              decision.rationale,
              undefined,
              projectSlug,
              ["auto-detected"],
              undefined,
              { source: "auto-session-lifecycle", session_id: sessionId },
            );
          } catch (err) {
            api.logger.warn?.(`memory-memoryrelay: auto decision_record failed: ${String(err)}`);
          }
        }

        // End session with summary
        const summary = generateSessionSummary(messages);
        await client.endSession(sessionId, summary);
        api.logger.debug?.(`memory-memoryrelay: auto-session ended ${sessionId}`);
      } catch (err) {
        api.logger.warn?.(`memory-memoryrelay: auto session_end failed (non-blocking): ${String(err)}`);
      } finally {
        autoSessionMap.delete(sessionKey);
      }
    }

    // --- Existing capture pipeline ---
    try {
      const requestCtx = buildRequestContext(event, config);
      const pipelineCtx = { requestCtx, config, client, sessionResolver, localCache, syncDaemon };
      await runPipeline(capturePipeline, { messages }, pipelineCtx);
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: capture failed: ${String(err)}`);
    }
  });
}
