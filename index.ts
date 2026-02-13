/**
 * OpenClaw Memory Plugin - MemoryRelay
 *
 * Long-term memory with vector search using MemoryRelay API.
 * Provides auto-recall and auto-capture via lifecycle hooks.
 *
 * API: https://api.memoryrelay.net
 * Docs: https://memoryrelay.io
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// Types
// ============================================================================

interface MemoryRelayConfig {
  apiKey: string;
  agentId: string;
  apiUrl?: string;
  autoCapture?: boolean;
  autoRecall?: boolean;
  recallLimit?: number;
  recallThreshold?: number;
}

interface Memory {
  id: string;
  content: string;
  agent_id: string;
  user_id: string;
  metadata: Record<string, string>;
  entities: string[];
  created_at: number;
  updated_at: number;
}

interface SearchResult {
  memory: Memory;
  score: number;
}

// ============================================================================
// MemoryRelay API Client
// ============================================================================

class MemoryRelayClient {
  constructor(
    private readonly apiKey: string,
    private readonly agentId: string,
    private readonly apiUrl: string = "https://api.memoryrelay.net",
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "User-Agent": "openclaw-memory-memoryrelay/0.1.0",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `MemoryRelay API error: ${response.status} ${response.statusText}` +
          (errorData.message ? ` - ${errorData.message}` : ""),
      );
    }

    return response.json();
  }

  async store(content: string, metadata?: Record<string, string>): Promise<Memory> {
    return this.request<Memory>("POST", "/v1/memories", {
      content,
      metadata,
      agent_id: this.agentId,
    });
  }

  async search(
    query: string,
    limit: number = 5,
    threshold: number = 0.3,
  ): Promise<SearchResult[]> {
    const response = await this.request<{ data: SearchResult[] }>(
      "POST",
      "/v1/memories/search",
      {
        query,
        limit,
        threshold,
        agent_id: this.agentId,
      },
    );
    return response.data || [];
  }

  async list(limit: number = 20, offset: number = 0): Promise<Memory[]> {
    const response = await this.request<{ data: Memory[] }>(
      "GET",
      `/v1/memories/memories?limit=${limit}&offset=${offset}`,
    );
    return response.data || [];
  }

  async get(id: string): Promise<Memory> {
    return this.request<Memory>("GET", `/v1/memories/${id}`);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>("DELETE", `/v1/memories/${id}`);
  }

  async health(): Promise<{ status: string }> {
    return this.request<{ status: string }>("GET", "/v1/health");
  }

  async stats(): Promise<{ total_memories: number; last_updated?: string }> {
    const response = await this.request<{ data: { total_memories: number; last_updated?: string } }>(
      "GET",
      `/v1/stats?agent_id=${encodeURIComponent(this.agentId)}`,
    );
    return response.data || { total_memories: 0 };
  }
}

// ============================================================================
// Pattern Detection (for auto-capture)
// ============================================================================

const CAPTURE_PATTERNS = [
  /remember\s+(?:that\s+)?/i,
  /(?:my|the)\s+(?:name|email|phone|address|preference)/i,
  /important(?:ly)?[:\s]/i,
  /always\s+(?:use|prefer|want)/i,
  /(?:do|don't)\s+(?:like|want|prefer)/i,
  /(?:api|key|token|password|secret)(?:\s+is)?[:\s]/i,
  /(?:ssh|server|host|ip|port)(?:\s+is)?[:\s]/i,
];

function shouldCapture(text: string): boolean {
  if (text.length < 20 || text.length > 2000) {
    return false;
  }
  return CAPTURE_PATTERNS.some((pattern) => pattern.test(text));
}

// ============================================================================
// Plugin Export
// ============================================================================

export default async function plugin(api: OpenClawPluginApi): Promise<void> {
  // Debug: log what config we're receiving
  api.logger.info(`memory-memoryrelay: plugin loaded, checking config...`);
  api.logger.info(`memory-memoryrelay: pluginConfig type: ${typeof api.pluginConfig}`);
  api.logger.info(`memory-memoryrelay: pluginConfig keys: ${api.pluginConfig ? Object.keys(api.pluginConfig).join(', ') : 'null'}`);
  
  const cfg = api.pluginConfig as MemoryRelayConfig | undefined;
  
  // Try to get config from multiple sources
  const apiKey = cfg?.apiKey || process.env.MEMORYRELAY_API_KEY;
  const agentId = cfg?.agentId || process.env.MEMORYRELAY_AGENT_ID || "default";
  
  if (!apiKey) {
    api.logger.error(
      "memory-memoryrelay: missing API key. Configure in one of these ways:\n" +
      "  1. Add to config: plugins.entries.\"plugin-memoryrelay-ai\".config.apiKey\n" +
      "  2. Set environment variable: MEMORYRELAY_API_KEY\n" +
      "  3. Run: cat ~/.openclaw/openclaw.json | jq '.plugins.entries.\"plugin-memoryrelay-ai\".config = {\"apiKey\": \"YOUR_KEY\", \"agentId\": \"YOUR_AGENT\"}' > /tmp/config.json && mv /tmp/config.json ~/.openclaw/openclaw.json\n" +
      "Get your API key from: https://memoryrelay.ai"
    );
    return;
  }
  
  api.logger.info(`memory-memoryrelay: using agentId: ${agentId}`);

  const client = new MemoryRelayClient(
    apiKey,
    agentId,
    cfg?.apiUrl || "https://api.memoryrelay.net",
  );

  // Verify connection on startup
  try {
    await client.health();
    api.logger.info(`memory-memoryrelay: connected to ${cfg.apiUrl || "api.memoryrelay.net"}`);
  } catch (err) {
    api.logger.error(`memory-memoryrelay: health check failed: ${String(err)}`);
    return;
  }

  // ========================================================================
  // Status Reporting (for openclaw status command)
  // ========================================================================

  // Register gateway RPC method for status probing
  // This allows OpenClaw's status command to query plugin availability
  api.registerGatewayMethod?.("memory.status", async ({ respond }) => {
    try {
      const health = await client.health();
      let memoryCount = 0;
      
      // Try to get stats if the endpoint exists
      try {
        const stats = await client.stats();
        memoryCount = stats.total_memories || 0;
      } catch (statsErr) {
        // Stats endpoint may not exist yet - that's okay, just report 0
        api.logger.debug?.(`memory-memoryrelay: stats endpoint unavailable: ${String(statsErr)}`);
      }
      
      const isConnected = health.status === "ok" || health.status === "healthy";
      
      respond(true, {
        available: true,
        connected: isConnected,
        endpoint: cfg?.apiUrl || "api.memoryrelay.net",
        memoryCount: memoryCount,
        agentId: agentId,
        // OpenClaw checks status.vector.available for memory plugins
        vector: {
          available: true,
          enabled: true,
        },
      });
    } catch (err) {
      respond(true, {
        available: false,
        connected: false,
        error: String(err),
        endpoint: cfg?.apiUrl || "api.memoryrelay.net",
        agentId: agentId,
        // Report vector as unavailable when API fails
        vector: {
          available: false,
          enabled: true,
        },
      });
    }
  });

  // ========================================================================
  // Tools (using JSON Schema directly)
  // ========================================================================

  // memory_store tool
  api.registerTool(
    {
      name: "memory_store",
      description:
        "Store a new memory in MemoryRelay. Use this to save important information, facts, preferences, or context that should be remembered for future conversations.",
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
        },
        required: ["content"],
      },
      execute: async (_id, { content, metadata }: { content: string; metadata?: Record<string, string> }) => {
        try {
          const memory = await client.store(content, metadata);
          return {
            content: [
              {
                type: "text",
                text: `Memory stored successfully (id: ${memory.id.slice(0, 8)}...)`,
              },
            ],
            details: { id: memory.id, stored: true },
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Failed to store memory: ${String(err)}` }],
            details: { error: String(err) },
          };
        }
      },
    },
    { name: "memory_store" },
  );

  // memory_recall tool (semantic search)
  api.registerTool(
    {
      name: "memory_recall",
      description:
        "Search memories using natural language. Returns the most relevant memories based on semantic similarity.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language search query",
          },
          limit: {
            type: "number",
            description: "Maximum results (1-20)",
            minimum: 1,
            maximum: 20,
            default: 5,
          },
        },
        required: ["query"],
      },
      execute: async (_id, { query, limit = 5 }: { query: string; limit?: number }) => {
        try {
          const results = await client.search(query, limit, cfg.recallThreshold || 0.3);

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
    },
    { name: "memory_recall" },
  );

  // memory_forget tool
  api.registerTool(
    {
      name: "memory_forget",
      description: "Delete a memory by ID or search for memories to forget.",
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
          const results = await client.search(query, 5, 0.5);

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
            .map((r) => `- [${r.memory.id.slice(0, 8)}] ${r.memory.content.slice(0, 60)}...`)
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
    },
    { name: "memory_forget" },
  );

  // ========================================================================
  // CLI Commands
  // ========================================================================

  api.registerCli(
    ({ program }) => {
      const mem = program.command("memoryrelay").description("MemoryRelay memory plugin commands");

      mem
        .command("status")
        .description("Check MemoryRelay connection status")
        .action(async () => {
          try {
            const health = await client.health();
            console.log(`Status: ${health.status}`);
            console.log(`Agent ID: ${cfg.agentId}`);
            console.log(`API: ${cfg.apiUrl || "https://api.memoryrelay.net"}`);
          } catch (err) {
            console.error(`Connection failed: ${String(err)}`);
          }
        });

      mem
        .command("list")
        .description("List recent memories")
        .option("--limit <n>", "Max results", "10")
        .action(async (opts) => {
          const memories = await client.list(parseInt(opts.limit));
          for (const m of memories) {
            console.log(`[${m.id.slice(0, 8)}] ${m.content.slice(0, 80)}...`);
          }
          console.log(`\nTotal: ${memories.length} memories`);
        });

      mem
        .command("search")
        .description("Search memories")
        .argument("<query>", "Search query")
        .option("--limit <n>", "Max results", "5")
        .action(async (query, opts) => {
          const results = await client.search(query, parseInt(opts.limit));
          for (const r of results) {
            console.log(`[${r.score.toFixed(2)}] ${r.memory.content.slice(0, 80)}...`);
          }
        });
    },
    { commands: ["memoryrelay"] },
  );

  // ========================================================================
  // Lifecycle Hooks
  // ========================================================================

  // Auto-recall: inject relevant memories before agent starts
  if (cfg.autoRecall) {
    api.on("before_agent_start", async (event) => {
      if (!event.prompt || event.prompt.length < 10) {
        return;
      }

      try {
        const results = await client.search(
          event.prompt,
          cfg.recallLimit || 5,
          cfg.recallThreshold || 0.3,
        );

        if (results.length === 0) {
          return;
        }

        const memoryContext = results
          .map((r) => `- ${r.memory.content}`)
          .join("\n");

        api.logger.info?.(
          `memory-memoryrelay: injecting ${results.length} memories into context`,
        );

        return {
          prependContext: `<relevant-memories>\nThe following memories from MemoryRelay may be relevant:\n${memoryContext}\n</relevant-memories>`,
        };
      } catch (err) {
        api.logger.warn?.(`memory-memoryrelay: recall failed: ${String(err)}`);
      }
    });
  }

  // Auto-capture: analyze and store important information after agent ends
  if (cfg.autoCapture) {
    api.on("agent_end", async (event) => {
      if (!event.success || !event.messages || event.messages.length === 0) {
        return;
      }

      try {
        const texts: string[] = [];
        for (const msg of event.messages) {
          if (!msg || typeof msg !== "object") continue;
          const msgObj = msg as Record<string, unknown>;
          const role = msgObj.role;
          if (role !== "user" && role !== "assistant") continue;

          const content = msgObj.content;
          if (typeof content === "string") {
            texts.push(content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block &&
                typeof block === "object" &&
                "type" in block &&
                (block as Record<string, unknown>).type === "text" &&
                "text" in block
              ) {
                texts.push((block as Record<string, unknown>).text as string);
              }
            }
          }
        }

        const toCapture = texts.filter((text) => text && shouldCapture(text));
        if (toCapture.length === 0) return;

        let stored = 0;
        for (const text of toCapture.slice(0, 3)) {
          // Check for duplicates via search
          const existing = await client.search(text, 1, 0.95);
          if (existing.length > 0) continue;

          await client.store(text, { source: "auto-capture" });
          stored++;
        }

        if (stored > 0) {
          api.logger.info?.(`memory-memoryrelay: auto-captured ${stored} memories`);
        }
      } catch (err) {
        api.logger.warn?.(`memory-memoryrelay: capture failed: ${String(err)}`);
      }
    });
  }

  api.logger.info?.(
    `memory-memoryrelay: plugin loaded (autoRecall: ${cfg.autoRecall}, autoCapture: ${cfg.autoCapture})`,
  );
}
