import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";

export function registerProjectTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  isToolEnabled: (name: string) => boolean,
): void {

  // --------------------------------------------------------------------------
  // 29. project_register
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_register")) {
    api.registerTool((ctx) => ({

        name: "project_register",
        description: "Register a new project in MemoryRelay. Projects organize memories, decisions, patterns, and sessions.",
        parameters: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "URL-friendly project identifier (e.g., 'my-api', 'frontend-app').",
            },
            name: {
              type: "string",
              description: "Human-readable project name.",
            },
            description: {
              type: "string",
              description: "Project description.",
            },
            stack: {
              type: "object",
              description: "Technology stack details (e.g., {language: 'python', framework: 'fastapi'}).",
            },
            repo_url: {
              type: "string",
              description: "Repository URL.",
            },
          },
          required: ["slug", "name"],
        },
        execute: async (
          _id,
          args: {
            slug: string;
            name: string;
            description?: string;
            stack?: Record<string, unknown>;
            repo_url?: string;
          },
        ) => {
          try {
            const result = await client.registerProject(
              args.slug,
              args.name,
              args.description,
              args.stack,
              args.repo_url,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to register project: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_register" },
    );
  }

  // --------------------------------------------------------------------------
  // 30. project_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_list")) {
    api.registerTool((ctx) => ({

        name: "project_list",
        description: "List all registered projects.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum projects to return. Default 20.",
              minimum: 1,
              maximum: 100,
            },
          },
        },
        execute: async (_id, args: { limit?: number }) => {
          try {
            const result = await client.listProjects(args.limit);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to list projects: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 31. project_info
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_info")) {
    api.registerTool((ctx) => ({

        name: "project_info",
        description: "Get detailed information about a specific project.",
        parameters: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "Project slug.",
            },
          },
          required: ["slug"],
        },
        execute: async (_id, args: { slug: string }) => {
          try {
            const result = await client.getProject(args.slug);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get project: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_info" },
    );
  }

  // --------------------------------------------------------------------------
  // 32. project_add_relationship
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_add_relationship")) {
    api.registerTool((ctx) => ({

        name: "project_add_relationship",
        description:
          "Add a relationship between two projects (e.g., depends_on, api_consumer, shares_schema, shares_infra, pattern_source, forked_from).",
        parameters: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description: "Source project slug.",
            },
            to: {
              type: "string",
              description: "Target project slug.",
            },
            type: {
              type: "string",
              description: "Relationship type (e.g., depends_on, api_consumer, shares_schema, shares_infra, pattern_source, forked_from).",
            },
            metadata: {
              type: "object",
              description: "Optional metadata about the relationship.",
            },
          },
          required: ["from", "to", "type"],
        },
        execute: async (
          _id,
          args: { from: string; to: string; type: string; metadata?: Record<string, unknown> },
        ) => {
          try {
            const result = await client.addProjectRelationship(
              args.from,
              args.to,
              args.type,
              args.metadata,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to add relationship: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_add_relationship" },
    );
  }

  // --------------------------------------------------------------------------
  // 33. project_dependencies
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_dependencies")) {
    api.registerTool((ctx) => ({

        name: "project_dependencies",
        description: "List projects that a given project depends on.",
        parameters: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: "Project slug.",
            },
          },
          required: ["project"],
        },
        execute: async (_id, args: { project: string }) => {
          try {
            const result = await client.getProjectDependencies(args.project);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get dependencies: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_dependencies" },
    );
  }

  // --------------------------------------------------------------------------
  // 34. project_dependents
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_dependents")) {
    api.registerTool((ctx) => ({

        name: "project_dependents",
        description: "List projects that depend on a given project.",
        parameters: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: "Project slug.",
            },
          },
          required: ["project"],
        },
        execute: async (_id, args: { project: string }) => {
          try {
            const result = await client.getProjectDependents(args.project);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get dependents: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_dependents" },
    );
  }

  // --------------------------------------------------------------------------
  // 35. project_related
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_related")) {
    api.registerTool((ctx) => ({

        name: "project_related",
        description: "List all projects related to a given project (any relationship direction).",
        parameters: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: "Project slug.",
            },
          },
          required: ["project"],
        },
        execute: async (_id, args: { project: string }) => {
          try {
            const result = await client.getProjectRelated(args.project);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get related projects: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_related" },
    );
  }

  // --------------------------------------------------------------------------
  // 36. project_impact
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_impact")) {
    api.registerTool((ctx) => ({

        name: "project_impact",
        description:
          "Analyze the impact of a proposed change on a project and its dependents. Helps understand blast radius before making changes.",
        parameters: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: "Project slug to analyze.",
            },
            change_description: {
              type: "string",
              description: "Description of the proposed change.",
            },
          },
          required: ["project", "change_description"],
        },
        execute: async (_id, args: { project: string; change_description: string }) => {
          try {
            const result = await client.projectImpact(args.project, args.change_description);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to analyze impact: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_impact" },
    );
  }

  // --------------------------------------------------------------------------
  // 37. project_shared_patterns
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_shared_patterns")) {
    api.registerTool((ctx) => ({

        name: "project_shared_patterns",
        description: "Find patterns shared between two projects. Useful for maintaining consistency across related projects.",
        parameters: {
          type: "object",
          properties: {
            project_a: {
              type: "string",
              description: "First project slug.",
            },
            project_b: {
              type: "string",
              description: "Second project slug.",
            },
          },
          required: ["project_a", "project_b"],
        },
        execute: async (_id, args: { project_a: string; project_b: string }) => {
          try {
            const result = await client.getSharedPatterns(args.project_a, args.project_b);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get shared patterns: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_shared_patterns" },
    );
  }

  // --------------------------------------------------------------------------
  // 38. project_context
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_context")) {
    api.registerTool((ctx) => ({

        name: "project_context",
        description:
          "Load full project context including hot-tier memories, active decisions, adopted patterns, and recent sessions. Call this FIRST when starting work on a project to understand existing context before making changes.",
        parameters: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: "Project slug.",
            },
          },
          required: ["project"],
        },
        execute: async (_id, args: { project: string }) => {
          try {
            const result = await client.getProjectContext(args.project);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to load project context: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "project_context" },
    );
  }
}
