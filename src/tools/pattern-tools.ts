import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";

export function registerPatternTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  isToolEnabled: (name: string) => boolean,
): void {
  const defaultProject = config.defaultProject;

  // --------------------------------------------------------------------------
  // 25. pattern_create
  // --------------------------------------------------------------------------
  if (isToolEnabled("pattern_create")) {
    api.registerTool((ctx) => ({

        name: "pattern_create",
        description:
          "Create a reusable pattern (coding convention, architecture pattern, or best practice) that can be shared across projects. Include example_code for maximum usefulness." +
          (defaultProject ? ` Source project defaults to '${defaultProject}' if not specified.` : ""),
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Pattern title.",
            },
            description: {
              type: "string",
              description: "Detailed description of the pattern, when to use it, and why.",
            },
            category: {
              type: "string",
              description: "Category (e.g., architecture, testing, error-handling, naming).",
            },
            example_code: {
              type: "string",
              description: "Example code demonstrating the pattern.",
            },
            scope: {
              type: "string",
              description: "Scope: global (visible to all projects) or project (visible to source project only).",
              enum: ["global", "project"],
            },
            tags: {
              type: "array",
              description: "Tags for categorization.",
              items: { type: "string" },
            },
            source_project: {
              type: "string",
              description: "Project slug where this pattern originated.",
            },
          },
          required: ["title", "description"],
        },
        execute: async (
          _id,
          args: {
            title: string;
            description: string;
            category?: string;
            example_code?: string;
            scope?: string;
            tags?: string[];
            source_project?: string;
          },
        ) => {
          try {
            const sourceProject = args.source_project ?? defaultProject;
            const result = await client.createPattern(
              args.title,
              args.description,
              args.category,
              args.example_code,
              args.scope,
              args.tags,
              sourceProject,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to create pattern: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "pattern_create" },
    );
  }

  // --------------------------------------------------------------------------
  // 26. pattern_search
  // --------------------------------------------------------------------------
  if (isToolEnabled("pattern_search")) {
    api.registerTool((ctx) => ({

        name: "pattern_search",
        description: "Search for established patterns by natural language query. Call this before writing code to find and follow existing conventions." +
          (defaultProject ? ` Scoped to project '${defaultProject}' by default.` : ""),
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language search query.",
            },
            category: {
              type: "string",
              description: "Filter by category.",
            },
            project: {
              type: "string",
              description: "Filter by project slug.",
            },
            limit: {
              type: "number",
              description: "Maximum results. Default 10.",
            },
            threshold: {
              type: "number",
              description: "Minimum similarity threshold (0-1). Default 0.3.",
            },
          },
          required: ["query"],
        },
        execute: async (
          _id,
          args: {
            query: string;
            category?: string;
            project?: string;
            limit?: number;
            threshold?: number;
          },
        ) => {
          try {
            const project = args.project ?? defaultProject;
            const result = await client.searchPatterns(
              args.query,
              args.category,
              project,
              args.limit,
              args.threshold,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to search patterns: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "pattern_search" },
    );
  }

  // --------------------------------------------------------------------------
  // 27. pattern_adopt
  // --------------------------------------------------------------------------
  if (isToolEnabled("pattern_adopt")) {
    api.registerTool((ctx) => ({

        name: "pattern_adopt",
        description: "Adopt an existing pattern for use in a project. Creates a link between the pattern and the project.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Pattern ID to adopt.",
            },
            project: {
              type: "string",
              description: "Project slug adopting the pattern.",
            },
          },
          required: ["id", "project"],
        },
        execute: async (_id, args: { id: string; project: string }) => {
          try {
            const result = await client.adoptPattern(args.id, args.project);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to adopt pattern: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "pattern_adopt" },
    );
  }

  // --------------------------------------------------------------------------
  // 28. pattern_suggest
  // --------------------------------------------------------------------------
  if (isToolEnabled("pattern_suggest")) {
    api.registerTool((ctx) => ({

        name: "pattern_suggest",
        description:
          "Get pattern suggestions for a project based on its stack and existing patterns from related projects.",
        parameters: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: "Project slug to get suggestions for.",
            },
            limit: {
              type: "number",
              description: "Maximum suggestions. Default 10.",
            },
          },
          required: ["project"],
        },
        execute: async (_id, args: { project: string; limit?: number }) => {
          try {
            const result = await client.suggestPatterns(args.project, args.limit);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to suggest patterns: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "pattern_suggest" },
    );
  }
}
