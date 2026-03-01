/**
 * OpenClaw Memory Plugin - MemoryRelay
 * Version: 0.6.0 (Enhanced)
 *
 * Long-term memory with vector search using MemoryRelay API.
 * Provides auto-recall and auto-capture via lifecycle hooks.
 *
 * API: https://api.memoryrelay.net
 * Docs: https://memoryrelay.io
 *
 * ENHANCEMENTS (v0.6.0):
 * - Retry logic with exponential backoff (3 attempts)
 * - Request timeout (30 seconds)
 * - Environment variable fallback support
 * - Channel filtering (excludeChannels config)
 * - Additional CLI commands (stats, delete, export)
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_API_URL = "https://api.memoryrelay.net";
const VALID_HEALTH_STATUSES = ["ok", "healthy", "up"];
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second

// ============================================================================
// Types
// ============================================================================

interface MemoryRelayConfig {
  apiKey?: string; // Optional now (can use env var)
  agentId?: string; // Optional now (can use env var)
  apiUrl?: string;
  autoCapture?: boolean;
  autoRecall?: boolean;
  recallLimit?: number;
  recallThreshold?: number;
  excludeChannels?: string[]; // NEW: Channels to skip auto-recall
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

interface Stats {
  total_memories: number;
  last_updated?: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable (network/timeout errors)
 */
function isRetryableError(error: unknown): boolean {
  const errStr = String(error).toLowerCase();
  return (
    errStr.includes("timeout") ||
    errStr.includes("econnrefused") ||
    errStr.includes("enotfound") ||
    errStr.includes("network") ||
    errStr.includes("fetch failed") ||
    errStr.includes("502") ||
    errStr.includes("503") ||
    errStr.includes("504")
  );
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw err;
  }
}

// ============================================================================
// MemoryRelay API Client (Enhanced)
// ============================================================================

class MemoryRelayClient {
  constructor(
    private readonly apiKey: string,
    private readonly agentId: string,
    private readonly apiUrl: string = DEFAULT_API_URL,
  ) {}

  /**
   * Make HTTP request with retry logic and timeout
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retryCount = 0,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": "openclaw-memory-memoryrelay/0.6.0",
          },
          body: body ? JSON.stringify(body) : undefined,
        },
        REQUEST_TIMEOUT_MS,
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(
          `MemoryRelay API error: ${response.status} ${response.statusText}` +
            (errorData.message ? ` - ${errorData.message}` : ""),
        );

        // Retry on 5xx errors
        if (response.status >= 500 && retryCount < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
          await sleep(delay);
          return this.request<T>(method, path, body, retryCount + 1);
        }

        throw error;
      }

      return response.json();
    } catch (err) {
      // Retry on network errors
      if (isRetryableError(err) && retryCount < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
        await sleep(delay);
        return this.request<T>(method, path, body, retryCount + 1);
      }

      throw err;
    }
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

  async stats(): Promise<Stats> {
    const response = await this.request<{ data: Stats }>(
      "GET",
      `/v1/stats?agent_id=${encodeURIComponent(this.agentId)}`,
    );
    return {
      total_memories: response.data?.total_memories ?? 0,
      last_updated: response.data?.last_updated,
    };
  }

  /**
   * Export all memories as JSON
   */
  async export(): Promise<Memory[]> {
    const allMemories: Memory[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const batch = await this.list(limit, offset);
      if (batch.length === 0) break;
      allMemories.push(...batch);
      offset += limit;
      if (batch.length < limit) break; // Last page
    }

    return allMemories;
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
  const cfg = api.pluginConfig as MemoryRelayConfig | undefined;

  // NEW: Fall back to environment variables
  const apiKey = cfg?.apiKey || process.env.MEMORYRELAY_API_KEY;
  const agentId = cfg?.agentId || process.env.MEMORYRELAY_AGENT_ID || api.agentName;

  if (!apiKey) {
    api.logger.error(
      "memory-memoryrelay: Missing API key in config or MEMORYRELAY_API_KEY env var.\n\n" +
        "REQUIRED: Add config after installation:\n\n" +
        'cat ~/.openclaw/openclaw.json | jq \'.plugins.entries."plugin-memoryrelay-ai".config = {\n' +
        '  "apiKey": "YOUR_API_KEY",\n' +
        '  "agentId": "YOUR_AGENT_ID"\n' +
        "}' > /tmp/config.json && mv /tmp/config.json ~/.openclaw/openclaw.json\n\n" +
        "Or set environment variable:\n" +
        'export MEMORYRELAY_API_KEY="mem_prod_..."\n\n' +
        "Then restart: openclaw gateway restart\n\n" +
        "Get your API key from: https://memoryrelay.ai",
    );
    return;
  }

  if (!agentId) {
    api.logger.error("memory-memoryrelay: Missing agentId in config or MEMORYRELAY_AGENT_ID env var");
    return;
  }

  const apiUrl = cfg?.apiUrl || process.env.MEMORYRELAY_API_URL || DEFAULT_API_URL;
  const client = new MemoryRelayClient(apiKey, agentId, apiUrl);

  // Verify connection on startup (with timeout)
  try {
    await client.health();
    api.logger.info(`memory-memoryrelay: connected to ${apiUrl}`);
  } catch (err) {
    api.logger.error(`memory-memoryrelay: health check failed: ${String(err)}`);
    // Continue loading plugin even if health check fails (will retry on first use)
  }

  // ========================================================================
  // Status Reporting (for openclaw status command)
  // ========================================================================

  api.registerGatewayMethod?.("memory.status", async ({ respond }) => {
    try {
      const health = await client.health();
      let memoryCount = 0;

      try {
        const stats = await client.stats();
        memoryCount = stats.total_memories;
      } catch (statsErr) {
        api.logger.debug?.(`memory-memoryrelay: stats endpoint unavailable: ${String(statsErr)}`);
      }

      const healthStatus = String(health.status).toLowerCase();
      const isConnected = VALID_HEALTH_STATUSES.includes(healthStatus);

      respond(true, {
        available: true,
        connected: isConnected,
        endpoint: apiUrl,
        memoryCount: memoryCount,
        agentId: agentId,
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
        endpoint: apiUrl,
        agentId: agentId,
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
          const results = await client.search(query, limit, cfg?.recallThreshold || 0.3);

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
  // CLI Commands (Enhanced)
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
            const stats = await client.stats();
            console.log(`Status: ${health.status}`);
            console.log(`Agent ID: ${agentId}`);
            console.log(`API: ${apiUrl}`);
            console.log(`Total Memories: ${stats.total_memories}`);
            if (stats.last_updated) {
              console.log(`Last Updated: ${new Date(stats.last_updated).toLocaleString()}`);
            }
          } catch (err) {
            console.error(`Connection failed: ${String(err)}`);
          }
        });

      mem
        .command("stats")
        .description("Show agent statistics")
        .action(async () => {
          try {
            const stats = await client.stats();
            console.log(`Total Memories: ${stats.total_memories}`);
            if (stats.last_updated) {
              console.log(`Last Updated: ${new Date(stats.last_updated).toLocaleString()}`);
            }
          } catch (err) {
            console.error(`Failed to fetch stats: ${String(err)}`);
          }
        });

      mem
        .command("list")
        .description("List recent memories")
        .option("--limit <n>", "Max results", "10")
        .action(async (opts) => {
          try {
            const memories = await client.list(parseInt(opts.limit));
            for (const m of memories) {
              console.log(`[${m.id.slice(0, 8)}] ${m.content.slice(0, 80)}...`);
            }
            console.log(`\nTotal: ${memories.length} memories`);
          } catch (err) {
            console.error(`Failed to list memories: ${String(err)}`);
          }
        });

      mem
        .command("search")
        .description("Search memories")
        .argument("<query>", "Search query")
        .option("--limit <n>", "Max results", "5")
        .action(async (query, opts) => {
          try {
            const results = await client.search(query, parseInt(opts.limit));
            for (const r of results) {
              console.log(`[${r.score.toFixed(2)}] ${r.memory.content.slice(0, 80)}...`);
            }
          } catch (err) {
            console.error(`Search failed: ${String(err)}`);
          }
        });

      mem
        .command("delete")
        .description("Delete a memory by ID")
        .argument("<id>", "Memory ID")
        .action(async (id) => {
          try {
            await client.delete(id);
            console.log(`Memory ${id.slice(0, 8)}... deleted.`);
          } catch (err) {
            console.error(`Delete failed: ${String(err)}`);
          }
        });

      mem
        .command("export")
        .description("Export all memories to JSON file")
        .option("--output <path>", "Output file path", "memories-export.json")
        .action(async (opts) => {
          try {
            console.log("Exporting memories...");
            const memories = await client.export();
            const fs = await import("fs/promises");
            await fs.writeFile(opts.output, JSON.stringify(memories, null, 2));
            console.log(`Exported ${memories.length} memories to ${opts.output}`);
          } catch (err) {
            console.error(`Export failed: ${String(err)}`);
          }
        });
    },
    { commands: ["memoryrelay"] },
  );

  // ========================================================================
  // Lifecycle Hooks
  // ========================================================================

  // Auto-recall: inject relevant memories before agent starts
  if (cfg?.autoRecall) {
    api.on("before_agent_start", async (event) => {
      if (!event.prompt || event.prompt.length < 10) {
        return;
      }

      // NEW: Check if current channel is excluded
      if (cfg.excludeChannels && event.channel) {
        const channelId = String(event.channel);
        if (cfg.excludeChannels.some((excluded) => channelId.includes(excluded))) {
          api.logger.debug?.(
            `memory-memoryrelay: skipping auto-recall for excluded channel: ${channelId}`,
          );
          return;
        }
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

        const memoryContext = results.map((r) => `- ${r.memory.content}`).join("\n");

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
  if (cfg?.autoCapture) {
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
    `memory-memoryrelay: plugin loaded (autoRecall: ${cfg?.autoRecall}, autoCapture: ${cfg?.autoCapture})`,
  );
}
