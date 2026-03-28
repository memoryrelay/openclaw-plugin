import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";

export function registerEntityTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  isToolEnabled: (name: string) => boolean,
): void {

  // --------------------------------------------------------------------------
  // 10. entity_create
  // --------------------------------------------------------------------------
  if (isToolEnabled("entity_create")) {
    api.registerTool((ctx) => ({

        name: "entity_create",
        description:
          "Create a named entity (person, place, organization, project, concept) for the knowledge graph. Entities help organize and connect memories.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Entity name (1-200 characters).",
            },
            type: {
              type: "string",
              description: "Entity type classification.",
              enum: ["person", "place", "organization", "project", "concept", "other"],
            },
            metadata: {
              type: "object",
              description: "Optional key-value metadata.",
              additionalProperties: { type: "string" },
            },
          },
          required: ["name", "type"],
        },
        execute: async (
          _id,
          args: { name: string; type: string; metadata?: Record<string, string> },
        ) => {
          try {
            const result = await client.createEntity(args.name, args.type, args.metadata);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to create entity: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "entity_create" },
    );
  }

  // --------------------------------------------------------------------------
  // 11. entity_link
  // --------------------------------------------------------------------------
  if (isToolEnabled("entity_link")) {
    api.registerTool((ctx) => ({

        name: "entity_link",
        description: "Link an entity to a memory to establish relationships in the knowledge graph.",
        parameters: {
          type: "object",
          properties: {
            entity_id: {
              type: "string",
              description: "Entity UUID.",
            },
            memory_id: {
              type: "string",
              description: "Memory UUID.",
            },
            relationship: {
              type: "string",
              description:
                'Relationship type (e.g., "mentioned_in", "created_by", "relates_to"). Default "mentioned_in".',
            },
          },
          required: ["entity_id", "memory_id"],
        },
        execute: async (
          _id,
          args: { entity_id: string; memory_id: string; relationship?: string },
        ) => {
          try {
            const result = await client.linkEntity(
              args.entity_id,
              args.memory_id,
              args.relationship,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to link entity: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "entity_link" },
    );
  }

  // --------------------------------------------------------------------------
  // 12. entity_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("entity_list")) {
    api.registerTool((ctx) => ({

        name: "entity_list",
        description: "List entities in the knowledge graph.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum entities to return. Default 20.",
              minimum: 1,
              maximum: 100,
            },
            offset: {
              type: "number",
              description: "Offset for pagination. Default 0.",
              minimum: 0,
            },
          },
        },
        execute: async (_id, args: { limit?: number; offset?: number }) => {
          try {
            const result = await client.listEntities(args.limit, args.offset);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to list entities: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "entity_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 13. entity_graph
  // --------------------------------------------------------------------------
  if (isToolEnabled("entity_graph")) {
    api.registerTool((ctx) => ({

        name: "entity_graph",
        description:
          "Explore the knowledge graph around an entity. Returns the entity and its neighborhood of connected entities and memories.",
        parameters: {
          type: "object",
          properties: {
            entity_id: {
              type: "string",
              description: "Entity UUID to explore from.",
            },
            depth: {
              type: "number",
              description: "How many hops to traverse. Default 2.",
              minimum: 1,
              maximum: 5,
            },
            max_neighbors: {
              type: "number",
              description: "Maximum neighbors per node. Default 10.",
              minimum: 1,
              maximum: 50,
            },
          },
          required: ["entity_id"],
        },
        execute: async (
          _id,
          args: { entity_id: string; depth?: number; max_neighbors?: number },
        ) => {
          try {
            const result = await client.entityGraph(
              args.entity_id,
              args.depth,
              args.max_neighbors,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get entity graph: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "entity_graph" },
    );
  }
}
