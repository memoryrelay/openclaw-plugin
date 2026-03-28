import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";

export function registerDecisionTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  isToolEnabled: (name: string) => boolean,
): void {
  const defaultProject = config.defaultProject;

  // --------------------------------------------------------------------------
  // 21. decision_record
  // --------------------------------------------------------------------------
  if (isToolEnabled("decision_record")) {
    api.registerTool((ctx) => ({

        name: "decision_record",
        description:
          "Record an architectural or design decision. Captures the rationale and alternatives considered for future reference. Always check existing decisions with decision_check first to avoid contradictions." +
          (defaultProject ? ` Project defaults to '${defaultProject}' if not specified.` : ""),
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title summarizing the decision.",
            },
            rationale: {
              type: "string",
              description: "Why this decision was made. Include context and reasoning.",
            },
            alternatives: {
              type: "string",
              description: "What alternatives were considered and why they were rejected.",
            },
            project: {
              type: "string",
              description: "Project slug this decision applies to.",
            },
            tags: {
              type: "array",
              description: "Tags for categorizing the decision.",
              items: { type: "string" },
            },
            status: {
              type: "string",
              description: "Decision status.",
              enum: ["active", "experimental"],
            },
            metadata: {
              type: "object",
              description: "Optional key-value metadata to attach to the decision.",
              additionalProperties: { type: "string" },
            },
          },
          required: ["title", "rationale"],
        },
        execute: async (
          _id,
          args: {
            title: string;
            rationale: string;
            alternatives?: string;
            project?: string;
            tags?: string[];
            status?: string;
            metadata?: Record<string, string>;
          },
        ) => {
          try {
            const project = args.project ?? defaultProject;

            // Merge user-provided metadata with sender identity from tool context
            const metadata: Record<string, string> = { ...(args.metadata ?? {}) };
            if (ctx.requesterSenderId) {
              metadata.sender_id = ctx.requesterSenderId;
            }

            const result = await client.recordDecision(
              args.title,
              args.rationale,
              args.alternatives,
              project,
              args.tags,
              args.status,
              Object.keys(metadata).length > 0 ? metadata : undefined,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to record decision: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "decision_record" },
    );
  }

  // --------------------------------------------------------------------------
  // 22. decision_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("decision_list")) {
    api.registerTool((ctx) => ({

        name: "decision_list",
        description: "List recorded decisions, optionally filtered by project, status, or tags." +
          (defaultProject ? ` Scoped to project '${defaultProject}' by default.` : ""),
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum decisions to return. Default 20.",
              minimum: 1,
              maximum: 100,
            },
            project: {
              type: "string",
              description: "Filter by project slug.",
            },
            status: {
              type: "string",
              description: "Filter by status.",
              enum: ["active", "superseded", "reverted", "experimental"],
            },
            tags: {
              type: "string",
              description: "Comma-separated tags to filter by.",
            },
          },
        },
        execute: async (
          _id,
          args: { limit?: number; project?: string; status?: string; tags?: string },
        ) => {
          try {
            const project = args.project ?? defaultProject;
            const result = await client.listDecisions(args.limit, project, args.status, args.tags);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to list decisions: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "decision_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 23. decision_supersede
  // --------------------------------------------------------------------------
  if (isToolEnabled("decision_supersede")) {
    api.registerTool((ctx) => ({

        name: "decision_supersede",
        description:
          "Supersede an existing decision with a new one. The old decision is marked as superseded and linked to the replacement.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "ID of the decision to supersede.",
            },
            title: {
              type: "string",
              description: "Title of the new replacement decision.",
            },
            rationale: {
              type: "string",
              description: "Why the previous decision is being replaced.",
            },
            alternatives: {
              type: "string",
              description: "Alternatives considered for the new decision.",
            },
            tags: {
              type: "array",
              description: "Tags for the new decision.",
              items: { type: "string" },
            },
            metadata: {
              type: "object",
              description: "Optional key-value metadata to attach to the new decision.",
              additionalProperties: { type: "string" },
            },
          },
          required: ["id", "title", "rationale"],
        },
        execute: async (
          _id,
          args: {
            id: string;
            title: string;
            rationale: string;
            alternatives?: string;
            tags?: string[];
            metadata?: Record<string, string>;
          },
        ) => {
          try {
            const result = await client.supersedeDecision(
              args.id,
              args.title,
              args.rationale,
              args.alternatives,
              args.tags,
              args.metadata,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to supersede decision: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "decision_supersede" },
    );
  }

  // --------------------------------------------------------------------------
  // 24. decision_check
  // --------------------------------------------------------------------------
  if (isToolEnabled("decision_check")) {
    api.registerTool((ctx) => ({

        name: "decision_check",
        description:
          "Check if there are existing decisions relevant to a topic. ALWAYS call this before making architectural choices to avoid contradicting past decisions." +
          (defaultProject ? ` Scoped to project '${defaultProject}' by default.` : ""),
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language description of the topic or decision area.",
            },
            project: {
              type: "string",
              description: "Project slug to scope the search.",
            },
            limit: {
              type: "number",
              description: "Maximum results. Default 5.",
            },
            threshold: {
              type: "number",
              description: "Minimum similarity threshold (0-1). Default 0.3.",
            },
            include_superseded: {
              type: "boolean",
              description: "Include superseded decisions in results. Default false.",
            },
          },
          required: ["query"],
        },
        execute: async (
          _id,
          args: {
            query: string;
            project?: string;
            limit?: number;
            threshold?: number;
            include_superseded?: boolean;
          },
        ) => {
          try {
            const project = args.project ?? defaultProject;
            const result = await client.checkDecisions(
              args.query,
              project,
              args.limit,
              args.threshold,
              args.include_superseded,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to check decisions: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "decision_check" },
    );
  }
}
