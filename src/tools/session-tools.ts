import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";
import type { SessionResolver } from "../context/session-resolver.js";

export function registerSessionTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  sessionResolver: SessionResolver,
  isToolEnabled: (name: string) => boolean,
): void {
  const defaultProject = config.defaultProject;

  // --------------------------------------------------------------------------
  // 17. session_start
  // --------------------------------------------------------------------------
  if (isToolEnabled("session_start")) {
    api.registerTool((ctx) => ({

        name: "session_start",
        description:
          "Start a new work session. Sessions track the lifecycle of a task or conversation for later review. Call this early in your workflow and save the returned session ID for session_end later." +
          (defaultProject ? ` Project defaults to '${defaultProject}' if not specified.` : ""),
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Session title describing the goal or task.",
            },
            project: {
              type: "string",
              description: "Project slug to associate this session with.",
            },
            metadata: {
              type: "object",
              description: "Optional key-value metadata.",
              additionalProperties: { type: "string" },
            },
          },
        },
        execute: async (
          _id,
          args: { title?: string; project?: string; metadata?: Record<string, string> },
        ) => {
          try {
            const project = args.project ?? defaultProject;
            const result = await client.startSession(args.title, project, args.metadata);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to start session: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "session_start" },
    );
  }

  // --------------------------------------------------------------------------
  // 18. session_end
  // --------------------------------------------------------------------------
  if (isToolEnabled("session_end")) {
    api.registerTool((ctx) => ({

        name: "session_end",
        description: "End an active session with a summary of what was accomplished. Always include a meaningful summary — it serves as the historical record of the session.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Session ID to end.",
            },
            summary: {
              type: "string",
              description: "Summary of what was accomplished during this session.",
            },
          },
          required: ["id"],
        },
        execute: async (_id, args: { id: string; summary?: string }) => {
          try {
            const result = await client.endSession(args.id, args.summary);
            return {
              content: [{ type: "text", text: `Session ${args.id.slice(0, 8)}... ended.` }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to end session: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "session_end" },
    );
  }

  // --------------------------------------------------------------------------
  // 19. session_recall
  // --------------------------------------------------------------------------
  if (isToolEnabled("session_recall")) {
    api.registerTool((ctx) => ({

        name: "session_recall",
        description: "Retrieve details of a specific session including its timeline and associated memories.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Session ID to retrieve.",
            },
          },
          required: ["id"],
        },
        execute: async (_id, args: { id: string }) => {
          try {
            const result = await client.getSession(args.id);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to recall session: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "session_recall" },
    );
  }

  // --------------------------------------------------------------------------
  // 20. session_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("session_list")) {
    api.registerTool((ctx) => ({

        name: "session_list",
        description: "List sessions, optionally filtered by project or status." +
          (defaultProject ? ` Scoped to project '${defaultProject}' by default.` : ""),
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum sessions to return. Default 20.",
              minimum: 1,
              maximum: 100,
            },
            project: {
              type: "string",
              description: "Filter by project slug.",
            },
            status: {
              type: "string",
              description: "Filter by status (active, ended).",
              enum: ["active", "ended"],
            },
          },
        },
        execute: async (
          _id,
          args: { limit?: number; project?: string; status?: string },
        ) => {
          try {
            const project = args.project ?? defaultProject;
            const result = await client.listSessions(args.limit, project, args.status);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to list sessions: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "session_list" },
    );
  }
}
