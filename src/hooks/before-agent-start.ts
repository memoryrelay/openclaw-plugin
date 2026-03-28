// src/hooks/before-agent-start.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";

export function registerBeforeAgentStart(
  api: OpenClawPluginApi,
  config: PluginConfig,
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

    const prependContext = `<memoryrelay-workflow>\n${workflowInstructions}\n</memoryrelay-workflow>`;

    return { prependContext };
  });
}
