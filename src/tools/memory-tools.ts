import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";
import type { SessionResolver } from "../context/session-resolver.js";

export function registerMemoryTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  sessionResolver: SessionResolver,
  isToolEnabled: (name: string) => boolean,
): void {
  const defaultProject = config.defaultProject;

  // --------------------------------------------------------------------------
  // 1. memory_store
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_store")) {
    api.registerTool((ctx) => ({

        name: "memory_store",
        description:
          "Store a new memory in MemoryRelay. Use this to save important information, facts, preferences, or context that should be remembered for future conversations." +
          (defaultProject ? ` Project defaults to '${defaultProject}' if not specified.` : "") +
          " Set deduplicate=true to avoid storing near-duplicate memories.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The memory content to store. Be specific and include relevant context.",
            },
            metadata: {
              type: "object",
              description: "Optional key-value metadata to attach to the memory",
              additionalProperties: { type: "string" },
            },
            deduplicate: {
              type: "boolean",
              description: "If true, check for duplicate memories before storing. Default false.",
            },
            dedup_threshold: {
              type: "number",
              description: "Similarity threshold for deduplication (0-1). Default 0.95.",
            },
            project: {
              type: "string",
              description: "Project slug to associate with this memory.",
            },
            importance: {
              type: "number",
              description: "Importance score (0-1). Higher values are retained longer.",
            },
            tier: {
              type: "string",
              description: "Memory tier: hot, warm, or cold.",
              enum: ["hot", "warm", "cold"],
            },
            session_id: {
              type: "string",
              description: "Optional MemoryRelay session UUID to associate this memory with. If omitted and project is set, plugin auto-creates session via external_id.",
            },
            scope: {
              type: "string",
              description: "Memory scope: 'session' (current conversation) or 'long-term' (persistent). Default: 'long-term'.",
              enum: ["session", "long-term"],
            },
          },
          required: ["content"],
        },
        execute: async (
          _id,
          args: {
            content: string;
            metadata?: Record<string, string>;
            deduplicate?: boolean;
            dedup_threshold?: number;
            project?: string;
            importance?: number;
            tier?: string;
            session_id?: string;
            scope?: string;
          },
        ) => {
          try {
            const { content, metadata: rawMetadata, session_id: explicitSessionId, scope, ...opts } = args;

            // --------------------------------------------------------------------------
            // COGNITIVE FIREWALL: Saliency & Anti-Echo Filter
            // --------------------------------------------------------------------------
            const minLength = config.saliency?.minContentLength ?? 10;
            const noisePatterns = config.saliency?.noisePatterns ?? [
              "\\[\\[.*?\\]\\]",
              "great (question|observation|point)",
              "i'd be happy to",
              "here is the result",
              "i have (completed|updated|fixed|implemented)",
              "i will (now|first|next)",
              "let me (check|verify|double-check)",
              "saliency gate:.*",
              "understood\\.",
              "correct\\.",
            ];

            const isNoise = noisePatterns.some(pattern => new RegExp(pattern, "i").test(content));

            if (isNoise) {
              return {
                content: [{ type: "text", text: "Saliency Gate: Content flagged as low-value/noise. Store operation aborted to prevent memory pollution." }],
                details: { blocked: true, reason: "low_saliency" },
              };
            }

            if (content.length < minLength) {
              return {
                content: [{ type: "text", text: `Saliency Gate: Content too short (${content.length} < ${minLength} chars). Operation aborted.` }],
                details: { blocked: true, reason: "too_short" },
              };
            }
            // --------------------------------------------------------------------------

            // Auto-tag with sender identity from tool context
            const metadata = rawMetadata || {};
            if (ctx.requesterSenderId && !metadata.sender_id) {
              metadata.sender_id = ctx.requesterSenderId;
            }


            // Apply defaultProject fallback before session resolution
            if (!opts.project && defaultProject) opts.project = defaultProject;

            // Get session_id from SessionResolver if project context available
            // Priority: explicit session_id > context session > no session
            let sessionId: string | undefined = explicitSessionId;

            if (!sessionId && (opts.project || ctx.workspaceDir)) {
              try {
                const entry = await sessionResolver.resolve({
                  sessionKey: opts.project || `workspace-${(ctx.workspaceDir || "").split(/[/\\]/).pop()}`,
                  agentId: null,
                  channel: null,
                  trigger: null,
                  prompt: "",
                  isSubagent: false,
                  parentSessionKey: null,
                  namespace: opts.project || "default",
                  timestamp: Date.now(),
                });
                sessionId = entry.sessionId;
              } catch {
                // Session resolution failed — continue without session
              }
            }

            // Build request options with session_id as top-level parameter
            const storeOpts = {
              ...opts,
              ...(sessionId && { session_id: sessionId }),
              ...(scope && { scope }),
            };

            const memory = await client.store(content, metadata, storeOpts);
            return {
              content: [
                {
                  type: "text",
                  text: `Memory stored successfully (id: ${memory.id.slice(0, 8)}...)${sessionId ? ` in session ${sessionId.slice(0, 8)}...` : ''}`,
                },
              ],
              details: { id: memory.id, stored: true, session_id: sessionId },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to store memory: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_store" },
    );
  }

  // --------------------------------------------------------------------------
  // 2. memory_recall
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_recall")) {
    api.registerTool((ctx) => ({

        name: "memory_recall",
        description:
          "Search memories using natural language. Returns the most relevant memories based on semantic similarity to the query." +
          (defaultProject ? ` Results scoped to project '${defaultProject}' by default; pass project explicitly to override or omit to search all.` : ""),
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language search query",
            },
            limit: {
              type: "number",
              description: "Maximum results (1-50). Default 5.",
              minimum: 1,
              maximum: 50,
            },
            threshold: {
              type: "number",
              description: "Minimum similarity threshold (0-1). Default 0.3.",
            },
            project: {
              type: "string",
              description: "Filter by project slug.",
            },
            tier: {
              type: "string",
              description: "Filter by memory tier: hot, warm, or cold.",
              enum: ["hot", "warm", "cold"],
            },
            min_importance: {
              type: "number",
              description: "Minimum importance score filter (0-1).",
            },
            compress: {
              type: "boolean",
              description: "If true, compress results for token efficiency.",
            },
            scope: {
              type: "string",
              description: "Search scope: 'session', 'long-term', or 'all'. Default: 'all'.",
              enum: ["session", "long-term", "all"],
            },
          },
          required: ["query"],
        },
        execute: async (
          _id,
          args: {
            query: string;
            limit?: number;
            threshold?: number;
            project?: string;
            tier?: string;
            min_importance?: number;
            compress?: boolean;
            scope?: string;
          },
        ) => {
          try {
            const {
              query,
              limit = 5,
              threshold,
              project,
              tier,
              min_importance,
              compress,
              scope,
            } = args;
            const searchThreshold = threshold ?? config?.recallThreshold ?? 0.3;
            const searchProject = project ?? defaultProject;
            const results = await client.search(query, limit, searchThreshold, {
              project: searchProject,
              tier,
              min_importance,
              compress,
              ...(scope && { scope }),
            });

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No relevant memories found." }],
                details: { count: 0 },
              };
            }

            const formatted = results
              .map(
                (r) =>
                  `- [${r.score.toFixed(2)}] ${r.memory.content.slice(0, 200)}${
                    r.memory.content.length > 200 ? "..." : ""
                  }`,
              )
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} relevant memories:\n${formatted}`,
                },
              ],
              details: {
                count: results.length,
                memories: results.map((r) => ({
                  id: r.memory.id,
                  content: r.memory.content,
                  score: r.score,
                })),
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Search failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_recall" },
    );
  }

  // --------------------------------------------------------------------------
  // 3. memory_forget
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_forget")) {
    api.registerTool((ctx) => ({

        name: "memory_forget",
        description: "Delete a memory by ID, or search by query to find candidates. Provide memoryId for direct deletion, or query to search first. A single high-confidence match (>0.9) is auto-deleted; otherwise candidates are listed for you to choose.",
        parameters: {
          type: "object",
          properties: {
            memoryId: {
              type: "string",
              description: "Memory ID to delete",
            },
            query: {
              type: "string",
              description: "Search query to find memory",
            },
          },
        },
        execute: async (_id, { memoryId, query }: { memoryId?: string; query?: string }) => {
          if (memoryId) {
            try {
              await client.delete(memoryId);
              return {
                content: [{ type: "text", text: `Memory ${memoryId.slice(0, 8)}... deleted.` }],
                details: { action: "deleted", id: memoryId },
              };
            } catch (err) {
              return {
                content: [{ type: "text", text: `Delete failed: ${String(err)}` }],
                details: { error: String(err) },
              };
            }
          }

          if (query) {
            const results = await client.search(query, 5, 0.5, { project: defaultProject });

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No matching memories found." }],
                details: { count: 0 },
              };
            }

            // If single high-confidence match, delete it
            if (results.length === 1 && results[0].score > 0.9) {
              await client.delete(results[0].memory.id);
              return {
                content: [
                  { type: "text", text: `Forgotten: "${results[0].memory.content.slice(0, 60)}..."` },
                ],
                details: { action: "deleted", id: results[0].memory.id },
              };
            }

            const list = results
              .map((r) => `- [${r.memory.id}] ${r.memory.content.slice(0, 60)}...`)
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} candidates. Specify memoryId:\n${list}`,
                },
              ],
              details: { action: "candidates", count: results.length },
            };
          }

          return {
            content: [{ type: "text", text: "Provide query or memoryId." }],
            details: { error: "missing_param" },
          };
        },
      }),
      { name: "memory_forget" },
    );
  }

  // --------------------------------------------------------------------------
  // 4. memory_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_list")) {
    api.registerTool((ctx) => ({

        name: "memory_list",
        description: "List recent memories chronologically for this agent. Use to review what has been stored or to find memory IDs for update/delete operations.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Number of memories to return (1-100). Default 20.",
              minimum: 1,
              maximum: 100,
            },
            offset: {
              type: "number",
              description: "Offset for pagination. Default 0.",
              minimum: 0,
            },
            scope: {
              type: "string",
              description: "List scope: 'session', 'long-term', or 'all'. Default: 'all'.",
              enum: ["session", "long-term", "all"],
            },
          },
        },
        execute: async (_id, args: { limit?: number; offset?: number; scope?: string }) => {
          try {
            const memories = await client.list(args.limit ?? 20, args.offset ?? 0, {
              ...(args.scope && { scope: args.scope }),
            });
            if (memories.length === 0) {
              return {
                content: [{ type: "text", text: "No memories found." }],
                details: { count: 0 },
              };
            }
            const formatted = memories
              .map((m) => `- [${m.id}] ${m.content.slice(0, 120)}`)
              .join("\n");
            return {
              content: [{ type: "text", text: `${memories.length} memories:\n${formatted}` }],
              details: { count: memories.length, memories },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to list memories: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 5. memory_get
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_get")) {
    api.registerTool((ctx) => ({

        name: "memory_get",
        description: "Retrieve a specific memory by its ID.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The memory ID (UUID) to retrieve.",
            },
          },
          required: ["id"],
        },
        execute: async (_id, args: { id: string }) => {
          try {
            const memory = await client.get(args.id);
            return {
              content: [{ type: "text", text: JSON.stringify(memory, null, 2) }],
              details: { memory },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get memory: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_get" },
    );
  }

  // --------------------------------------------------------------------------
  // 6. memory_update
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_update")) {
    api.registerTool((ctx) => ({

        name: "memory_update",
        description: "Update the content of an existing memory. Use to correct or expand stored information.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The memory ID (UUID) to update.",
            },
            content: {
              type: "string",
              description: "The new content to replace the existing memory.",
            },
            metadata: {
              type: "object",
              description: "Updated metadata (replaces existing).",
              additionalProperties: { type: "string" },
            },
          },
          required: ["id", "content"],
        },
        execute: async (_id, args: { id: string; content: string; metadata?: Record<string, string> }) => {
          try {
            const memory = await client.update(args.id, args.content, args.metadata);
            return {
              content: [{ type: "text", text: `Memory ${args.id.slice(0, 8)}... updated.` }],
              details: { id: memory.id, updated: true },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to update memory: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_update" },
    );
  }

  // --------------------------------------------------------------------------
  // 7. memory_batch_store
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_batch_store")) {
    api.registerTool((ctx) => ({

        name: "memory_batch_store",
        description: "Store multiple memories at once. More efficient than individual calls for bulk storage.",
        parameters: {
          type: "object",
          properties: {
            memories: {
              type: "array",
              description: "Array of memories to store.",
              items: {
                type: "object",
                properties: {
                  content: { type: "string", description: "Memory content." },
                  metadata: {
                    type: "object",
                    description: "Optional metadata.",
                    additionalProperties: { type: "string" },
                  },
                },
                required: ["content"],
              },
            },
          },
          required: ["memories"],
        },
        execute: async (
          _id,
          args: { memories: Array<{ content: string; metadata?: Record<string, string> }> },
        ) => {
          try {
            // Auto-tag each memory with sender identity from tool context
            if (ctx.requesterSenderId) {
              for (const mem of args.memories) {
                const metadata = mem.metadata || {};
                if (!metadata.sender_id) {
                  metadata.sender_id = ctx.requesterSenderId;
                }
                mem.metadata = metadata;
              }
            }

            const result = await client.batchStore(args.memories);
            return {
              content: [
                {
                  type: "text",
                  text: `Batch stored ${args.memories.length} memories successfully.`,
                },
              ],
              details: { count: args.memories.length, result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Batch store failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_batch_store" },
    );
  }

  // --------------------------------------------------------------------------
  // 8. memory_context
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_context")) {
    api.registerTool((ctx) => ({

        name: "memory_context",
        description:
          "Build a context window from relevant memories, optimized for injecting into agent prompts with token budget awareness." +
          (defaultProject ? ` Project defaults to '${defaultProject}' if not specified.` : ""),
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The query to build context around.",
            },
            limit: {
              type: "number",
              description: "Maximum number of memories to include.",
            },
            threshold: {
              type: "number",
              description: "Minimum similarity threshold (0-1).",
            },
            max_tokens: {
              type: "number",
              description: "Maximum token budget for the context.",
            },
            project: {
              type: "string",
              description: "Project slug to scope the context.",
            },
          },
          required: ["query"],
        },
        execute: async (
          _id,
          args: { query: string; limit?: number; threshold?: number; max_tokens?: number; project?: string },
        ) => {
          try {
            const project = args.project ?? defaultProject;
            const result = await client.buildContext(
              args.query,
              args.limit,
              args.threshold,
              args.max_tokens,
              project,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Context build failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_context" },
    );
  }

  // --------------------------------------------------------------------------
  // 9. memory_promote
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_promote")) {
    api.registerTool((ctx) => ({

        name: "memory_promote",
        description:
          "Promote a memory by updating its importance score and/or tier. Use to ensure critical memories are retained longer.",
        parameters: {
          type: "object",
          properties: {
            memory_id: {
              type: "string",
              description: "The memory ID to promote.",
            },
            importance: {
              type: "number",
              description: "New importance score (0-1).",
              minimum: 0,
              maximum: 1,
            },
            tier: {
              type: "string",
              description: "Target tier: hot, warm, or cold.",
              enum: ["hot", "warm", "cold"],
            },
          },
          required: ["memory_id", "importance"],
        },
        execute: async (_id, args: { memory_id: string; importance: number; tier?: string }) => {
          try {
            const result = await client.promote(args.memory_id, args.importance, args.tier);
            return {
              content: [
                {
                  type: "text",
                  text: `Memory ${args.memory_id.slice(0, 8)}... promoted (importance: ${args.importance}${args.tier ? `, tier: ${args.tier}` : ""}).`,
                },
              ],
              details: { result },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Promote failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      }),
      { name: "memory_promote" },
    );
  }
}
