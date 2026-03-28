import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";

export function registerAgentTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  isToolEnabled: (name: string) => boolean,
): void {

  // --------------------------------------------------------------------------
  // 14. agent_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("agent_list")) {
    api.registerTool((ctx) => ({

        name: "agent_list",
        description: "List available agents.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum agents to return. Default 20.",
              minimum: 1,
              maximum: 100,
            },
          },
        },
        execute: async (_id, args: { limit?: number }) => {
          try {
            const result = await client.listAgents(args.limit);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to list agents: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "agent_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 15. agent_create
  // --------------------------------------------------------------------------
  if (isToolEnabled("agent_create")) {
    api.registerTool((ctx) => ({

        name: "agent_create",
        description: "Create a new agent. Agents serve as memory namespaces and isolation boundaries.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Agent name.",
            },
            description: {
              type: "string",
              description: "Optional agent description.",
            },
          },
          required: ["name"],
        },
        execute: async (_id, args: { name: string; description?: string }) => {
          try {
            const result = await client.createAgent(args.name, args.description);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to create agent: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "agent_create" },
    );
  }

  // --------------------------------------------------------------------------
  // 16. agent_get
  // --------------------------------------------------------------------------
  if (isToolEnabled("agent_get")) {
    api.registerTool((ctx) => ({

        name: "agent_get",
        description: "Get details about a specific agent by ID.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Agent UUID.",
            },
          },
          required: ["id"],
        },
        execute: async (_id, args: { id: string }) => {
          try {
            const result = await client.getAgent(args.id);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get agent: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "agent_get" },
    );
  }
}
