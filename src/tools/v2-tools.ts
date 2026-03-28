import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";

export function registerV2Tools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  isToolEnabled: (name: string) => boolean,
): void {
  const defaultProject = config.defaultProject;

  // --------------------------------------------------------------------------
  // 40. memory_store_async
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_store_async")) {
    api.registerTool((_ctx) => ({
      name: "memory_store_async",
      description:
        "Store a memory asynchronously using V2 API. Returns immediately (<50ms) with a job ID. Background workers generate the embedding. Use memory_status to poll for completion. Prefer this over memory_store for high-throughput or latency-sensitive applications." +
        (defaultProject ? ` Project defaults to '${defaultProject}' if not specified.` : ""),
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The memory content to store (1-50,000 characters).",
          },
          metadata: {
            type: "object",
            description: "Optional key-value metadata to attach to the memory.",
            additionalProperties: { type: "string" },
          },
          project: {
            type: "string",
            description: "Project slug to associate with this memory (max 100 characters).",
            maxLength: 100,
          },
          importance: {
            type: "number",
            description: "Importance score (0-1). Higher values are retained longer.",
            minimum: 0,
            maximum: 1,
          },
          tier: {
            type: "string",
            description: "Memory tier: hot, warm, or cold.",
            enum: ["hot", "warm", "cold"],
          },
          webhook_url: {
            type: "string",
            description: "Optional webhook URL to notify when async storage completes.",
          },
        },
        required: ["content"],
      },
      execute: async (
        _id,
        args: {
          content: string;
          metadata?: Record<string, string>;
          project?: string;
          importance?: number;
          tier?: string;
          webhook_url?: string;
        },
      ) => {
        try {
          const { content, metadata, importance, tier, webhook_url } = args;
          let project = args.project;
          if (!project && defaultProject) project = defaultProject;
          const result = await client.storeAsync(content, metadata, project, importance, tier, webhook_url);
          return {
            content: [
              {
                type: "text",
                text: `Memory queued for async storage (id: ${result.id}, job_id: ${result.job_id}). Use memory_status to check completion.`,
              },
            ],
            details: result,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Failed to queue memory: ${String(err)}` }],
            details: { error: String(err) },
          };
        }
      },
    }), { name: "memory_store_async" });
  }

  // --------------------------------------------------------------------------
  // 41. memory_status
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_status")) {
    api.registerTool((_ctx) => ({
      name: "memory_status",
      description:
        "Check the processing status of a memory created via memory_store_async. Status values: pending (waiting for worker), processing (generating embedding), ready (searchable), failed (error occurred).",
      parameters: {
        type: "object",
        properties: {
          memory_id: {
            type: "string",
            description: "The memory ID returned by memory_store_async.",
          },
        },
        required: ["memory_id"],
      },
      execute: async (
        _id,
        args: { memory_id: string },
      ) => {
        try {
          const status = await client.getMemoryStatus(args.memory_id);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(status, null, 2),
              },
            ],
            details: status,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Failed to get memory status: ${String(err)}` }],
            details: { error: String(err) },
          };
        }
      },
    }), { name: "memory_status" });
  }

  // --------------------------------------------------------------------------
  // 42. context_build
  // --------------------------------------------------------------------------
  if (isToolEnabled("context_build")) {
    api.registerTool((_ctx) => ({
      name: "context_build",
      description:
        "Build a ranked context bundle from memories with optional AI summarization. Searches for relevant memories, ranks them by composite score, and optionally generates an AI summary. Useful for building token-efficient context windows.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The query to build context for.",
          },
          max_memories: {
            type: "number",
            description: "Maximum number of memories to include (1-100).",
            minimum: 1,
            maximum: 100,
          },
          max_tokens: {
            type: "number",
            description: "Maximum tokens for the context bundle (100-128000).",
            minimum: 100,
            maximum: 128000,
          },
          ai_enhanced: {
            type: "boolean",
            description: "If true, generate an AI summary of the retrieved memories.",
          },
          search_mode: {
            type: "string",
            description: "Search strategy: semantic, hybrid, or keyword.",
            enum: ["semantic", "hybrid", "keyword"],
          },
          exclude_memory_ids: {
            type: "array",
            description: "Memory IDs to exclude from results.",
            items: { type: "string" },
          },
          llm_api_url: {
            type: "string",
            description: "Optional custom LLM API URL for AI summarization.",
          },
          llm_model: {
            type: "string",
            description: "Optional LLM model name for AI summarization.",
          },
        },
        required: ["query"],
      },
      execute: async (
        _id,
        args: {
          query: string;
          max_memories?: number;
          max_tokens?: number;
          ai_enhanced?: boolean;
          search_mode?: "semantic" | "hybrid" | "keyword";
          exclude_memory_ids?: string[];
          llm_api_url?: string;
          llm_model?: string;
        },
      ) => {
        try {
          const context = await client.buildContextV2(args.query, {
            maxMemories: args.max_memories,
            maxTokens: args.max_tokens,
            aiEnhanced: args.ai_enhanced,
            searchMode: args.search_mode,
            excludeMemoryIds: args.exclude_memory_ids,
            llmApiUrl: args.llm_api_url,
            llmModel: args.llm_model,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(context, null, 2),
              },
            ],
            details: context,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Failed to build context: ${String(err)}` }],
            details: { error: String(err) },
          };
        }
      },
    }), { name: "context_build" });
  }
}
