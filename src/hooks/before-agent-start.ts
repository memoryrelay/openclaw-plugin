// src/hooks/before-agent-start.ts
import { basename } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient } from "../pipelines/types.js";
import { autoSessionMap } from "./auto-session-store.js";

/**
 * Resolve project slug from config, env, or working directory name.
 */
function resolveProjectSlug(config: PluginConfig, defaultProject: string | undefined): string | undefined {
  if (defaultProject) return defaultProject;
  if (config.defaultProject) return config.defaultProject;
  const envProject = process.env.MEMORYRELAY_DEFAULT_PROJECT;
  if (envProject) return envProject;
  try {
    return basename(process.cwd());
  } catch {
    return undefined;
  }
}

export function registerBeforeAgentStart(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  isToolEnabled: (name: string) => boolean,
  defaultProject: string | undefined,
): void {
  api.on("before_agent_start", async (event) => {
    if (!event.prompt || event.prompt.length < 10) {
      return;
    }

    // Check if current channel is excluded
    if (config?.excludeChannels && event.channel) {
      const channelId = String(event.channel);
      if (config.excludeChannels.some((excluded) => channelId.includes(excluded))) {
        api.logger.debug?.(
          `memory-memoryrelay: skipping for excluded channel: ${channelId}`,
        );
        return;
      }
    }

    // --- Auto session lifecycle: session_start + project_context ---
    const projectSlug = resolveProjectSlug(config, defaultProject);
    let projectContextBlock = "";

    try {
      const sessionKey = event.ctx?.sessionKey || event.sessionId || "";

      // Start a tracked session (non-blocking — we await but don't let failure block the turn)
      const today = new Date().toISOString().slice(0, 10);
      const sessionResult = await client.startSession(
        `Auto session ${today}`,
        projectSlug,
        { source: "openclaw-plugin", trigger: "before_agent_start" },
      );

      if (sessionResult?.id && sessionKey) {
        autoSessionMap.set(sessionKey, sessionResult.id);
        api.logger.debug?.(`memory-memoryrelay: auto-session started ${sessionResult.id}`);
      }
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: auto session_start failed (non-blocking): ${String(err)}`);
    }

    // Load project context (hot memories, decisions, patterns)
    if (projectSlug) {
      try {
        const ctx = await client.getProjectContext(projectSlug);
        if (ctx) {
          const parts: string[] = [];
          if (ctx.hot_memories?.length) {
            parts.push("### Hot Memories");
            for (const m of ctx.hot_memories.slice(0, 10)) {
              parts.push(`- ${m.content ?? m}`);
            }
          }
          if (ctx.recent_decisions?.length) {
            parts.push("### Active Decisions");
            for (const d of ctx.recent_decisions.slice(0, 5)) {
              parts.push(`- **${d.title}**: ${(d.rationale ?? "").slice(0, 200)}`);
            }
          }
          if (ctx.active_patterns?.length) {
            parts.push("### Adopted Patterns");
            for (const p of ctx.active_patterns.slice(0, 5)) {
              parts.push(`- **${p.title}**: ${(p.description ?? "").slice(0, 150)}`);
            }
          }
          if (parts.length > 0) {
            projectContextBlock = `\n\n## Project Context (${projectSlug})\n\n${parts.join("\n")}`;
          }
        }
      } catch (err) {
        api.logger.warn?.(`memory-memoryrelay: project_context failed (non-blocking): ${String(err)}`);
      }
    }

    // Build workflow instructions dynamically based on enabled tools
    const lines: string[] = [
      "You have MemoryRelay tools available for persistent memory across sessions.",
    ];

    if (defaultProject) {
      lines.push(`Default project: \`${defaultProject}\` (auto-applied when you omit the project parameter).`);
    }

    lines.push("", "## Recommended Workflow", "");

    // Starting work section — only include steps for enabled tools
    const startSteps: string[] = [];
    if (isToolEnabled("project_context")) {
      startSteps.push(`**Load context**: Call \`project_context(${defaultProject ? `"${defaultProject}"` : "project"})\` to load hot-tier memories, active decisions, and adopted patterns`);
    }
    if (isToolEnabled("session_start")) {
      startSteps.push(`**Start session**: Call \`session_start(title${defaultProject ? "" : ", project"})\` to begin tracking your work`);
    }
    if (isToolEnabled("decision_check")) {
      startSteps.push(`**Check decisions**: Call \`decision_check(query${defaultProject ? "" : ", project"})\` before making architectural choices`);
    }
    if (isToolEnabled("pattern_search")) {
      startSteps.push("**Find patterns**: Call `pattern_search(query)` to find established conventions before writing code");
    }

    if (startSteps.length > 0) {
      lines.push("When starting work on a project:");
      startSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
      lines.push("");
    }

    // While working section
    const workSteps: string[] = [];
    if (isToolEnabled("memory_store")) {
      workSteps.push("**Store findings**: Call `memory_store(content, metadata)` for important information worth remembering");
    }
    if (isToolEnabled("decision_record")) {
      workSteps.push(`**Record decisions**: Call \`decision_record(title, rationale${defaultProject ? "" : ", project"})\` when making significant architectural choices`);
    }
    if (isToolEnabled("pattern_create")) {
      workSteps.push("**Create patterns**: Call `pattern_create(title, description)` when establishing reusable conventions");
    }

    if (workSteps.length > 0) {
      lines.push("While working:");
      const offset = startSteps.length;
      workSteps.forEach((step, i) => lines.push(`${offset + i + 1}. ${step}`));
      lines.push("");
    }

    // When done section
    if (isToolEnabled("session_end")) {
      const offset = startSteps.length + workSteps.length;
      lines.push("When done:");
      lines.push(`${offset + 1}. **End session**: Call \`session_end(session_id, summary)\` with a summary of what was accomplished`);
      lines.push("");
    }

    // First-time setup — only if project tools are enabled
    if (isToolEnabled("project_register")) {
      lines.push("## First-Time Setup", "");
      lines.push("If the project is not yet registered, start with:");
      lines.push("1. `project_register(slug, name, description, stack)` to register the project");
      lines.push("2. Then follow the workflow above");
      lines.push("");
      if (isToolEnabled("project_list")) {
        lines.push("Use `project_list()` to see existing projects before registering a new one.");
      }
    }

    // Memory-only fallback — if no session/decision/project tools are enabled
    if (startSteps.length === 0 && workSteps.length === 0) {
      lines.push("Use `memory_store(content)` to save important information and `memory_recall(query)` to find relevant memories.");
    }

    const workflowInstructions = lines.join("\n");

    const prependContext = `<memoryrelay-workflow>\n${workflowInstructions}${projectContextBlock}\n</memoryrelay-workflow>`;

    return { prependContext };
  });
}
