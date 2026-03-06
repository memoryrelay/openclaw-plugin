/**
 * OpenClaw Memory Plugin - MemoryRelay
 * Version: 0.9.3 (OpenClaw Security Compliance)
 *
 * Long-term memory with vector search using MemoryRelay API.
 * Provides auto-recall and auto-capture via lifecycle hooks.
 * Includes: memories, entities, agents, sessions, decisions, patterns, projects.
 *
 * API: https://api.memoryrelay.net
 * Docs: https://memoryrelay.ai
 *
 * ENHANCEMENTS (v0.9.3):
 * - Removed fs.writeFile from export command (stdout only now)
 * - No filesystem operations - passes OpenClaw security validation
 * - Export usage: openclaw memoryrelay export > memories.json
 *
 * ENHANCEMENTS (v0.8.4):
 * - Removed file logging feature to pass OpenClaw security validation
 * - All debug logs now in-memory only (circular buffer)
 * - logFile config option deprecated (ignored with warning)
 * - Clean npm installation without security warnings
 * - Gateway methods for log access coming in v0.9.3
 *
 * ENHANCEMENTS (v0.8.3):
 * - Security fix: logFile restricted to relative paths
 * - Path validation (reject absolute paths and traversal)
 *
 * ENHANCEMENTS (v0.8.2):
 * - Human-readable gateway logs with memory previews
 * - Show similarity scores and memory snippets during auto-recall
 * - Performance indicators (✓/✗ and timing with SLOW warnings)
 * - Cleaner error messages in gateway logs
 *
 * ENHANCEMENTS (v0.8.0):
 * - Debug mode with comprehensive API call logging
 * - Enhanced status reporting with tool breakdown
 * - Request/response capture (verbose mode)
 * - Tool failure tracking and known issues display
 * - Performance metrics (duration, success rate)
 * - Recent activity display
 * - Formatted CLI output with Unicode symbols
 *
 * ENHANCEMENTS (v0.7.0):
 * - 39 tools covering all MemoryRelay API resources
 * - Session tracking, decision logging, pattern management, project context
 * - Agent workflow instructions injected via before_agent_start
 * - Retry logic with exponential backoff (3 attempts)
 * - Request timeout (30 seconds)
 * - Environment variable fallback support
 * - Channel filtering (excludeChannels config)
 * - Additional CLI commands (stats, delete, export)
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { DebugLogger, type LogEntry } from "./src/debug-logger.js";
import { StatusReporter } from "./src/status-reporter.js";

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
  apiKey?: string;
  agentId?: string;
  apiUrl?: string;
  autoCapture?: boolean;
  autoRecall?: boolean;
  recallLimit?: number;
  recallThreshold?: number;
  excludeChannels?: string[];
  defaultProject?: string;
  enabledTools?: string;
  // Debug and logging options (v0.8.0)
  debug?: boolean;
  verbose?: boolean;
  logFile?: string;
  maxLogEntries?: number;
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
// MemoryRelay API Client (Full Suite)
// ============================================================================

class MemoryRelayClient {
  private debugLogger?: DebugLogger;
  private statusReporter?: StatusReporter;
  private config?: MemoryRelayConfig;
  private api?: OpenClawPluginApi;

  constructor(
    private readonly apiKey: string,
    private readonly agentId: string,
    private readonly apiUrl: string = DEFAULT_API_URL,
    debugLogger?: DebugLogger,
    statusReporter?: StatusReporter,
    api?: OpenClawPluginApi,
  ) {
    this.debugLogger = debugLogger;
    this.statusReporter = statusReporter;
    this.api = api;
    this.config = api?.pluginConfig as MemoryRelayConfig | undefined;
  }

  /**
   * Extract tool name from API path
   */
  private extractToolName(path: string): string {
    // /v1/memories -> memory
    // /v1/memories/batch -> memory_batch
    // /v1/sessions/123/end -> session_end
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return "unknown";
    
    let toolName = parts[1].replace(/s$/, ""); // Remove trailing 's'
    
    // Check for specific endpoints
    if (path.includes("/batch")) toolName += "_batch";
    if (path.includes("/recall")) toolName += "_recall";
    if (path.includes("/context")) toolName += "_context";
    if (path.includes("/end")) toolName += "_end";
    if (path.includes("/health")) return "memory_health";
    
    return toolName;
  }

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
    const startTime = Date.now();
    const toolName = this.extractToolName(path);

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": "openclaw-memory-memoryrelay/0.8.0",
          },
          body: body ? JSON.stringify(body) : undefined,
        },
        REQUEST_TIMEOUT_MS,
      );

      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.detail || errorData.message || "";
        const error = new Error(
          `MemoryRelay API error: ${response.status} ${response.statusText}` +
            (errorMsg ? ` - ${errorMsg}` : ""),
        );

        // Log error
        if (this.debugLogger) {
          this.debugLogger.log({
            timestamp: new Date().toISOString(),
            tool: toolName,
            method,
            path,
            duration,
            status: "error",
            responseStatus: response.status,
            error: error.message,
            retries: retryCount,
            requestBody: this.debugLogger && body ? body : undefined,
          });

          // Enhanced gateway logging (v0.8.2): Readable error summary
          if (this.config.debug && this.api) {
            const retryMsg = retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : '';
            this.api.logger.warn?.(
              `memory-memoryrelay: ${toolName} → ${response.status} ${errorMsg || response.statusText}${retryMsg}`
            );
          }
        }

        // Track failure
        if (this.statusReporter) {
          this.statusReporter.recordFailure(toolName, `${response.status} ${errorMsg || response.statusText}`);
        }

        // Retry on 5xx errors
        if (response.status >= 500 && retryCount < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
          await sleep(delay);
          return this.request<T>(method, path, body, retryCount + 1);
        }

        throw error;
      }

      const result = await response.json();

      // Log success
      if (this.debugLogger) {
        this.debugLogger.log({
          timestamp: new Date().toISOString(),
          tool: toolName,
          method,
          path,
          duration,
          status: "success",
          responseStatus: response.status,
          retries: retryCount,
          requestBody: this.debugLogger && body ? body : undefined,
          responseBody: this.debugLogger && result ? result : undefined,
        });

        // Enhanced gateway logging (v0.8.2): Readable API call summary
        if (this.config.debug && this.api) {
          const statusSymbol = response.status < 400 ? '✓' : '✗';
          const durationColor = duration > 1000 ? ' (SLOW)' : duration > 500 ? ' (slow)' : '';
          this.api.logger.info?.(
            `memory-memoryrelay: ${toolName} → ${duration}ms ${statusSymbol}${durationColor}`
          );
        }
      }

      // Track success
      if (this.statusReporter) {
        this.statusReporter.recordSuccess(toolName);
      }

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;

      // Log error
      if (this.debugLogger) {
        this.debugLogger.log({
          timestamp: new Date().toISOString(),
          tool: toolName,
          method,
          path,
          duration,
          status: "error",
          error: String(err),
          retries: retryCount,
          requestBody: this.debugLogger && body ? body : undefined,
        });
      }

      // Track failure
      if (this.statusReporter) {
        this.statusReporter.recordFailure(toolName, String(err));
      }

      // Retry on network errors
      if (isRetryableError(err) && retryCount < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
        await sleep(delay);
        return this.request<T>(method, path, body, retryCount + 1);
      }

      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Memory operations
  // --------------------------------------------------------------------------

  async store(
    content: string,
    metadata?: Record<string, string>,
    options?: {
      deduplicate?: boolean;
      dedup_threshold?: number;
      project?: string;
      importance?: number;
      tier?: string;
    },
  ): Promise<Memory> {
    return this.request<Memory>("POST", "/v1/memories", {
      content,
      metadata,
      agent_id: this.agentId,
      ...options,
    });
  }

  async search(
    query: string,
    limit: number = 5,
    threshold: number = 0.3,
    options?: {
      include_confidential?: boolean;
      include_archived?: boolean;
      compress?: boolean;
      max_context_tokens?: number;
      project?: string;
      tier?: string;
      min_importance?: number;
    },
  ): Promise<SearchResult[]> {
    const response = await this.request<{ data: SearchResult[] }>(
      "POST",
      "/v1/memories/search",
      {
        query,
        limit,
        threshold,
        agent_id: this.agentId,
        ...options,
      },
    );
    return response.data || [];
  }

  async list(limit: number = 20, offset: number = 0): Promise<Memory[]> {
    const response = await this.request<{ data: Memory[] }>(
      "GET",
      `/v1/memories?limit=${limit}&offset=${offset}&agent_id=${encodeURIComponent(this.agentId)}`,
    );
    return response.data || [];
  }

  async get(id: string): Promise<Memory> {
    return this.request<Memory>("GET", `/v1/memories/${id}`);
  }

  async update(id: string, content: string, metadata?: Record<string, string>): Promise<Memory> {
    return this.request<Memory>("PUT", `/v1/memories/${id}`, {
      content,
      metadata,
    });
  }

  async delete(id: string): Promise<void> {
    await this.request<void>("DELETE", `/v1/memories/${id}`);
  }

  async batchStore(
    memories: Array<{ content: string; metadata?: Record<string, string> }>,
  ): Promise<any> {
    return this.request("POST", "/v1/memories/batch", {
      memories,
      agent_id: this.agentId,
    });
  }

  async buildContext(
    query: string,
    limit?: number,
    threshold?: number,
    maxTokens?: number,
    project?: string,
  ): Promise<any> {
    return this.request("POST", "/v1/memories/context", {
      query,
      limit,
      threshold,
      max_tokens: maxTokens,
      agent_id: this.agentId,
      project,
    });
  }

  async promote(memoryId: string, importance: number, tier?: string): Promise<any> {
    return this.request("PUT", `/v1/memories/${memoryId}/importance`, {
      importance,
      tier,
    });
  }

  // --------------------------------------------------------------------------
  // Entity operations
  // --------------------------------------------------------------------------

  async createEntity(
    name: string,
    type: string,
    metadata?: Record<string, string>,
  ): Promise<any> {
    return this.request("POST", "/v1/entities", {
      name,
      type,
      metadata,
      agent_id: this.agentId,
    });
  }

  async linkEntity(
    entityId: string,
    memoryId: string,
    relationship?: string,
  ): Promise<any> {
    return this.request("POST", `/v1/entities/links`, {
      entity_id: entityId,
      memory_id: memoryId,
      relationship,
    });
  }

  async listEntities(limit: number = 20, offset: number = 0): Promise<any> {
    return this.request("GET", `/v1/entities?limit=${limit}&offset=${offset}`);
  }

  async entityGraph(
    entityId: string,
    depth: number = 2,
    maxNeighbors: number = 10,
  ): Promise<any> {
    return this.request(
      "GET",
      `/v1/entities/${entityId}/neighborhood?depth=${depth}&max_neighbors=${maxNeighbors}`,
    );
  }

  // --------------------------------------------------------------------------
  // Agent operations
  // --------------------------------------------------------------------------

  async listAgents(limit: number = 20): Promise<any> {
    return this.request("GET", `/v1/agents?limit=${limit}`);
  }

  async createAgent(name: string, description?: string): Promise<any> {
    return this.request("POST", "/v1/agents", { name, description });
  }

  async getAgent(id: string): Promise<any> {
    return this.request("GET", `/v1/agents/${id}`);
  }

  // --------------------------------------------------------------------------
  // Session operations
  // --------------------------------------------------------------------------

  async startSession(
    title?: string,
    project?: string,
    metadata?: Record<string, string>,
  ): Promise<any> {
    return this.request("POST", "/v1/sessions", {
      title,
      project,
      metadata,
      agent_id: this.agentId,
    });
  }

  async endSession(id: string, summary?: string): Promise<any> {
    return this.request("PUT", `/v1/sessions/${id}/end`, { summary });
  }

  async getSession(id: string): Promise<any> {
    return this.request("GET", `/v1/sessions/${id}`);
  }

  async listSessions(
    limit: number = 20,
    project?: string,
    status?: string,
  ): Promise<any> {
    let path = `/v1/sessions?limit=${limit}`;
    if (project) path += `&project=${encodeURIComponent(project)}`;
    if (status) path += `&status=${encodeURIComponent(status)}`;
    return this.request("GET", path);
  }

  // --------------------------------------------------------------------------
  // Decision operations
  // --------------------------------------------------------------------------

  async recordDecision(
    title: string,
    rationale: string,
    alternatives?: string,
    project?: string,
    tags?: string[],
    status?: string,
  ): Promise<any> {
    return this.request("POST", "/v1/decisions", {
      title,
      rationale,
      alternatives,
      project_slug: project,
      tags,
      status,
      agent_id: this.agentId,
    });
  }

  async listDecisions(
    limit: number = 20,
    project?: string,
    status?: string,
    tags?: string,
  ): Promise<any> {
    let path = `/v1/decisions?limit=${limit}`;
    if (project) path += `&project=${encodeURIComponent(project)}`;
    if (status) path += `&status=${encodeURIComponent(status)}`;
    if (tags) path += `&tags=${encodeURIComponent(tags)}`;
    return this.request("GET", path);
  }

  async supersedeDecision(
    id: string,
    title: string,
    rationale: string,
    alternatives?: string,
    tags?: string[],
  ): Promise<any> {
    return this.request("POST", `/v1/decisions/${id}/supersede`, {
      title,
      rationale,
      alternatives,
      tags,
    });
  }

  async checkDecisions(
    query: string,
    project?: string,
    limit?: number,
    threshold?: number,
    includeSuperseded?: boolean,
  ): Promise<any> {
    const params = new URLSearchParams();
    params.set("query", query);
    if (project) params.set("project", project);
    if (limit !== undefined) params.set("limit", String(limit));
    if (threshold !== undefined) params.set("threshold", String(threshold));
    if (includeSuperseded) params.set("include_superseded", "true");
    return this.request("GET", `/v1/decisions/check?${params.toString()}`);
  }

  // --------------------------------------------------------------------------
  // Pattern operations
  // --------------------------------------------------------------------------

  async createPattern(
    title: string,
    description: string,
    category?: string,
    exampleCode?: string,
    scope?: string,
    tags?: string[],
    sourceProject?: string,
  ): Promise<any> {
    return this.request("POST", "/v1/patterns", {
      title,
      description,
      category,
      example_code: exampleCode,
      scope,
      tags,
      source_project: sourceProject,
    });
  }

  async searchPatterns(
    query: string,
    category?: string,
    project?: string,
    limit?: number,
    threshold?: number,
  ): Promise<any> {
    const params = new URLSearchParams();
    params.set("query", query);
    if (category) params.set("category", category);
    if (project) params.set("project", project);
    if (limit !== undefined) params.set("limit", String(limit));
    if (threshold !== undefined) params.set("threshold", String(threshold));
    return this.request("GET", `/v1/patterns/search?${params.toString()}`);
  }

  async adoptPattern(id: string, project: string): Promise<any> {
    return this.request("POST", `/v1/patterns/${id}/adopt`, { project });
  }

  async suggestPatterns(project: string, limit?: number): Promise<any> {
    let path = `/v1/patterns/suggest?project=${encodeURIComponent(project)}`;
    if (limit) path += `&limit=${limit}`;
    return this.request("GET", path);
  }

  // --------------------------------------------------------------------------
  // Project operations
  // --------------------------------------------------------------------------

  async registerProject(
    slug: string,
    name: string,
    description?: string,
    stack?: Record<string, unknown>,
    repoUrl?: string,
  ): Promise<any> {
    return this.request("POST", "/v1/projects", {
      slug,
      name,
      description,
      stack,
      repo_url: repoUrl,
    });
  }

  async listProjects(limit: number = 20): Promise<any> {
    return this.request("GET", `/v1/projects?limit=${limit}`);
  }

  async getProject(slug: string): Promise<any> {
    return this.request("GET", `/v1/projects/${encodeURIComponent(slug)}`);
  }

  async addProjectRelationship(
    from: string,
    to: string,
    type: string,
    metadata?: Record<string, unknown>,
  ): Promise<any> {
    return this.request("POST", `/v1/projects/${encodeURIComponent(from)}/relationships`, {
      target_project: to,
      relationship_type: type,
      metadata,
    });
  }

  async getProjectDependencies(project: string): Promise<any> {
    return this.request(
      "GET",
      `/v1/projects/${encodeURIComponent(project)}/dependencies`,
    );
  }

  async getProjectDependents(project: string): Promise<any> {
    return this.request(
      "GET",
      `/v1/projects/${encodeURIComponent(project)}/dependents`,
    );
  }

  async getProjectRelated(project: string): Promise<any> {
    return this.request(
      "GET",
      `/v1/projects/${encodeURIComponent(project)}/related`,
    );
  }

  async projectImpact(project: string, changeDescription: string): Promise<any> {
    return this.request(
      "POST",
      `/v1/projects/impact-analysis`,
      { project, change_description: changeDescription },
    );
  }

  async getSharedPatterns(projectA: string, projectB: string): Promise<any> {
    const params = new URLSearchParams();
    params.set("a", projectA);
    params.set("b", projectB);
    return this.request(
      "GET",
      `/v1/projects/shared-patterns?${params.toString()}`,
    );
  }

  async getProjectContext(project: string): Promise<any> {
    return this.request(
      "GET",
      `/v1/projects/${encodeURIComponent(project)}/context`,
    );
  }

  // --------------------------------------------------------------------------
  // Health & stats
  // --------------------------------------------------------------------------

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
      if (batch.length < limit) break;
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

  // Fall back to environment variables
  const apiKey = cfg?.apiKey || process.env.MEMORYRELAY_API_KEY;
  const agentId = cfg?.agentId || process.env.MEMORYRELAY_AGENT_ID || api.agentName;

  if (!apiKey) {
    api.logger.error(
      "memory-memoryrelay: Missing API key in config or MEMORYRELAY_API_KEY env var.\n\n" +
        "REQUIRED: Configure plugin via OpenClaw:\n\n" +
        "  openclaw config edit\n\n" +
        'Navigate to plugins.entries.plugin-memoryrelay-ai.config and add:\n' +
        '  {\n' +
        '    "apiKey": "YOUR_API_KEY",\n' +
        '    "agentId": "YOUR_AGENT_ID"\n' +
        '  }\n\n' +
        "Or set environment variable:\n" +
        '  export MEMORYRELAY_API_KEY="mem_prod_..."\n\n' +
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
  const defaultProject = cfg?.defaultProject || process.env.MEMORYRELAY_DEFAULT_PROJECT;
  
  // ========================================================================
  // Debug Logger and Status Reporter (v0.8.0)
  // ========================================================================
  
  const debugEnabled = cfg?.debug || false;
  const verboseEnabled = cfg?.verbose || false;
  const maxLogEntries = cfg?.maxLogEntries || 100;
  
  // Note: logFile is deprecated in v0.9.3 (removed for OpenClaw security compliance)
  // All debug logs are in-memory only. Use gateway methods to access logs.
  
  let debugLogger: DebugLogger | undefined;
  let statusReporter: StatusReporter | undefined;
  
  if (debugEnabled) {
    debugLogger = new DebugLogger({
      enabled: true,
      verbose: verboseEnabled,
      maxEntries: maxLogEntries,
    });
    
    api.logger.info(
      `memory-memoryrelay: debug mode enabled (verbose: ${verboseEnabled}, maxEntries: ${maxLogEntries}, in-memory only)`
    );
  }
  
  statusReporter = new StatusReporter(debugLogger);
  
  const client = new MemoryRelayClient(apiKey, agentId, apiUrl, debugLogger, statusReporter, api);

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
      // Get connection status
      const startTime = Date.now();
      const health = await client.health();
      const responseTime = Date.now() - startTime;
      
      const healthStatus = String(health.status).toLowerCase();
      const isConnected = VALID_HEALTH_STATUSES.includes(healthStatus);
      
      const connectionStatus = {
        status: isConnected ? "connected" as const : "disconnected" as const,
        endpoint: apiUrl,
        lastCheck: new Date().toISOString(),
        responseTime,
      };
      
      // Get memory stats
      let memoryCount = 0;
      try {
        const stats = await client.stats();
        memoryCount = stats.total_memories;
      } catch (statsErr) {
        api.logger.debug?.(`memory-memoryrelay: stats endpoint unavailable: ${String(statsErr)}`);
      }
      
      const memoryStats = {
        total_memories: memoryCount,
      };
      
      // Get config
      const pluginConfig = {
        agentId: agentId,
        autoRecall: cfg?.autoRecall ?? true,
        autoCapture: cfg?.autoCapture ?? false,
        recallLimit: cfg?.recallLimit ?? 5,
        recallThreshold: cfg?.recallThreshold ?? 0.3,
        excludeChannels: cfg?.excludeChannels ?? [],
        defaultProject: defaultProject,
      };
      
      // Build comprehensive status report
      if (statusReporter) {
        const report = statusReporter.buildReport(
          connectionStatus,
          pluginConfig,
          memoryStats,
          TOOL_GROUPS,
        );
        
        // Format and output
        const formatted = StatusReporter.formatReport(report);
        api.logger.info(formatted);
        
        // Also return structured data for programmatic access
        respond(true, {
          available: true,
          connected: isConnected,
          endpoint: apiUrl,
          memoryCount: memoryCount,
          agentId: agentId,
          debug: debugEnabled,
          verbose: verboseEnabled,
          report: report,
          vector: {
            available: true,
            enabled: true,
          },
        });
      } else {
        // Fallback to simple status (shouldn't happen)
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
      }
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
  // Helper to check if a tool is enabled (by group)
  // ========================================================================

  // Tool group mapping — matches MCP server's TOOL_GROUPS
  const TOOL_GROUPS: Record<string, string[]> = {
    memory: [
      "memory_store", "memory_recall", "memory_forget", "memory_list",
      "memory_get", "memory_update", "memory_batch_store", "memory_context",
      "memory_promote",
    ],
    entity: ["entity_create", "entity_link", "entity_list", "entity_graph"],
    agent: ["agent_list", "agent_create", "agent_get"],
    session: ["session_start", "session_end", "session_recall", "session_list"],
    decision: ["decision_record", "decision_list", "decision_supersede", "decision_check"],
    pattern: ["pattern_create", "pattern_search", "pattern_adopt", "pattern_suggest"],
    project: [
      "project_register", "project_list", "project_info",
      "project_add_relationship", "project_dependencies", "project_dependents",
      "project_related", "project_impact", "project_shared_patterns", "project_context",
    ],
    health: ["memory_health"],
  };

  // Build a set of enabled tool names from group names
  const enabledToolNames: Set<string> | null = (() => {
    if (!cfg?.enabledTools) return null; // all enabled
    const groups = cfg.enabledTools.split(",").map((s) => s.trim().toLowerCase());
    if (groups.includes("all")) return null;
    const enabled = new Set<string>();
    for (const group of groups) {
      const tools = TOOL_GROUPS[group];
      if (tools) {
        for (const tool of tools) {
          enabled.add(tool);
        }
      }
    }
    return enabled;
  })();

  function isToolEnabled(name: string): boolean {
    if (!enabledToolNames) return true;
    return enabledToolNames.has(name);
  }

  // ========================================================================
  // Tools (39 total)
  // ========================================================================

  // --------------------------------------------------------------------------
  // 1. memory_store
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_store")) {
    api.registerTool(
      {
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
              description: "Similarity threshold for deduplication (0-1). Default 0.9.",
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
          },
        ) => {
          try {
            const { content, metadata, ...opts } = args;
            if (!opts.project && defaultProject) opts.project = defaultProject;
            const memory = await client.store(content, metadata, opts);
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
  }

  // --------------------------------------------------------------------------
  // 2. memory_recall
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_recall")) {
    api.registerTool(
      {
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
            } = args;
            const searchThreshold = threshold ?? cfg?.recallThreshold ?? 0.3;
            const searchProject = project ?? defaultProject;
            const results = await client.search(query, limit, searchThreshold, {
              project: searchProject,
              tier,
              min_importance,
              compress,
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
      },
      { name: "memory_recall" },
    );
  }

  // --------------------------------------------------------------------------
  // 3. memory_forget
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_forget")) {
    api.registerTool(
      {
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
  }

  // --------------------------------------------------------------------------
  // 4. memory_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_list")) {
    api.registerTool(
      {
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
          },
        },
        execute: async (_id, args: { limit?: number; offset?: number }) => {
          try {
            const memories = await client.list(args.limit ?? 20, args.offset ?? 0);
            if (memories.length === 0) {
              return {
                content: [{ type: "text", text: "No memories found." }],
                details: { count: 0 },
              };
            }
            const formatted = memories
              .map((m) => `- [${m.id.slice(0, 8)}] ${m.content.slice(0, 120)}`)
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
      },
      { name: "memory_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 5. memory_get
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_get")) {
    api.registerTool(
      {
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
      },
      { name: "memory_get" },
    );
  }

  // --------------------------------------------------------------------------
  // 6. memory_update
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_update")) {
    api.registerTool(
      {
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
      },
      { name: "memory_update" },
    );
  }

  // --------------------------------------------------------------------------
  // 7. memory_batch_store
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_batch_store")) {
    api.registerTool(
      {
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
      },
      { name: "memory_batch_store" },
    );
  }

  // --------------------------------------------------------------------------
  // 8. memory_context
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_context")) {
    api.registerTool(
      {
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
      },
      { name: "memory_context" },
    );
  }

  // --------------------------------------------------------------------------
  // 9. memory_promote
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_promote")) {
    api.registerTool(
      {
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
      },
      { name: "memory_promote" },
    );
  }

  // --------------------------------------------------------------------------
  // 10. entity_create
  // --------------------------------------------------------------------------
  if (isToolEnabled("entity_create")) {
    api.registerTool(
      {
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
      },
      { name: "entity_create" },
    );
  }

  // --------------------------------------------------------------------------
  // 11. entity_link
  // --------------------------------------------------------------------------
  if (isToolEnabled("entity_link")) {
    api.registerTool(
      {
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
      },
      { name: "entity_link" },
    );
  }

  // --------------------------------------------------------------------------
  // 12. entity_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("entity_list")) {
    api.registerTool(
      {
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
      },
      { name: "entity_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 13. entity_graph
  // --------------------------------------------------------------------------
  if (isToolEnabled("entity_graph")) {
    api.registerTool(
      {
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
      },
      { name: "entity_graph" },
    );
  }

  // --------------------------------------------------------------------------
  // 14. agent_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("agent_list")) {
    api.registerTool(
      {
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
      },
      { name: "agent_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 15. agent_create
  // --------------------------------------------------------------------------
  if (isToolEnabled("agent_create")) {
    api.registerTool(
      {
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
      },
      { name: "agent_create" },
    );
  }

  // --------------------------------------------------------------------------
  // 16. agent_get
  // --------------------------------------------------------------------------
  if (isToolEnabled("agent_get")) {
    api.registerTool(
      {
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
      },
      { name: "agent_get" },
    );
  }

  // --------------------------------------------------------------------------
  // 17. session_start
  // --------------------------------------------------------------------------
  if (isToolEnabled("session_start")) {
    api.registerTool(
      {
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
      },
      { name: "session_start" },
    );
  }

  // --------------------------------------------------------------------------
  // 18. session_end
  // --------------------------------------------------------------------------
  if (isToolEnabled("session_end")) {
    api.registerTool(
      {
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
      },
      { name: "session_end" },
    );
  }

  // --------------------------------------------------------------------------
  // 19. session_recall
  // --------------------------------------------------------------------------
  if (isToolEnabled("session_recall")) {
    api.registerTool(
      {
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
      },
      { name: "session_recall" },
    );
  }

  // --------------------------------------------------------------------------
  // 20. session_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("session_list")) {
    api.registerTool(
      {
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
      },
      { name: "session_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 21. decision_record
  // --------------------------------------------------------------------------
  if (isToolEnabled("decision_record")) {
    api.registerTool(
      {
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
          },
        ) => {
          try {
            const project = args.project ?? defaultProject;
            const result = await client.recordDecision(
              args.title,
              args.rationale,
              args.alternatives,
              project,
              args.tags,
              args.status,
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
      },
      { name: "decision_record" },
    );
  }

  // --------------------------------------------------------------------------
  // 22. decision_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("decision_list")) {
    api.registerTool(
      {
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
      },
      { name: "decision_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 23. decision_supersede
  // --------------------------------------------------------------------------
  if (isToolEnabled("decision_supersede")) {
    api.registerTool(
      {
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
          },
        ) => {
          try {
            const result = await client.supersedeDecision(
              args.id,
              args.title,
              args.rationale,
              args.alternatives,
              args.tags,
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
      },
      { name: "decision_supersede" },
    );
  }

  // --------------------------------------------------------------------------
  // 24. decision_check
  // --------------------------------------------------------------------------
  if (isToolEnabled("decision_check")) {
    api.registerTool(
      {
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
      },
      { name: "decision_check" },
    );
  }

  // --------------------------------------------------------------------------
  // 25. pattern_create
  // --------------------------------------------------------------------------
  if (isToolEnabled("pattern_create")) {
    api.registerTool(
      {
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
      },
      { name: "pattern_create" },
    );
  }

  // --------------------------------------------------------------------------
  // 26. pattern_search
  // --------------------------------------------------------------------------
  if (isToolEnabled("pattern_search")) {
    api.registerTool(
      {
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
      },
      { name: "pattern_search" },
    );
  }

  // --------------------------------------------------------------------------
  // 27. pattern_adopt
  // --------------------------------------------------------------------------
  if (isToolEnabled("pattern_adopt")) {
    api.registerTool(
      {
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
      },
      { name: "pattern_adopt" },
    );
  }

  // --------------------------------------------------------------------------
  // 28. pattern_suggest
  // --------------------------------------------------------------------------
  if (isToolEnabled("pattern_suggest")) {
    api.registerTool(
      {
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
      },
      { name: "pattern_suggest" },
    );
  }

  // --------------------------------------------------------------------------
  // 29. project_register
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_register")) {
    api.registerTool(
      {
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
      },
      { name: "project_register" },
    );
  }

  // --------------------------------------------------------------------------
  // 30. project_list
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_list")) {
    api.registerTool(
      {
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
      },
      { name: "project_list" },
    );
  }

  // --------------------------------------------------------------------------
  // 31. project_info
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_info")) {
    api.registerTool(
      {
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
      },
      { name: "project_info" },
    );
  }

  // --------------------------------------------------------------------------
  // 32. project_add_relationship
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_add_relationship")) {
    api.registerTool(
      {
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
      },
      { name: "project_add_relationship" },
    );
  }

  // --------------------------------------------------------------------------
  // 33. project_dependencies
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_dependencies")) {
    api.registerTool(
      {
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
      },
      { name: "project_dependencies" },
    );
  }

  // --------------------------------------------------------------------------
  // 34. project_dependents
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_dependents")) {
    api.registerTool(
      {
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
      },
      { name: "project_dependents" },
    );
  }

  // --------------------------------------------------------------------------
  // 35. project_related
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_related")) {
    api.registerTool(
      {
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
      },
      { name: "project_related" },
    );
  }

  // --------------------------------------------------------------------------
  // 36. project_impact
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_impact")) {
    api.registerTool(
      {
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
      },
      { name: "project_impact" },
    );
  }

  // --------------------------------------------------------------------------
  // 37. project_shared_patterns
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_shared_patterns")) {
    api.registerTool(
      {
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
      },
      { name: "project_shared_patterns" },
    );
  }

  // --------------------------------------------------------------------------
  // 38. project_context
  // --------------------------------------------------------------------------
  if (isToolEnabled("project_context")) {
    api.registerTool(
      {
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
      },
      { name: "project_context" },
    );
  }

  // --------------------------------------------------------------------------
  // 39. memory_health
  // --------------------------------------------------------------------------
  if (isToolEnabled("memory_health")) {
    api.registerTool(
      {
        name: "memory_health",
        description: "Check the MemoryRelay API connectivity and health status.",
        parameters: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          try {
            const health = await client.health();
            return {
              content: [{ type: "text", text: JSON.stringify(health, null, 2) }],
              details: { health },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Health check failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_health" },
    );
  }

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
        .description("Export all memories to JSON (outputs to stdout)")
        .action(async () => {
          try {
            const memories = await client.export();
            console.log(JSON.stringify(memories, null, 2));
            console.error(`\n# Exported ${memories.length} memories. Redirect stdout to save: memoryrelay export > memories.json`);
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

  // Workflow instructions + auto-recall: always inject workflow guidance,
  // optionally recall relevant memories if autoRecall is enabled
  api.on("before_agent_start", async (event) => {
    if (!event.prompt || event.prompt.length < 10) {
      return;
    }

    // Check if current channel is excluded
    if (cfg?.excludeChannels && event.channel) {
      const channelId = String(event.channel);
      if (cfg.excludeChannels.some((excluded) => channelId.includes(excluded))) {
        api.logger.debug?.(
          `memory-memoryrelay: skipping for excluded channel: ${channelId}`,
        );
        return;
      }
    }

    // Build workflow instructions dynamically based on enabled tools
    const lines: string[] = [
      "You have MemoryRelay tools available for persistent memory across sessions.",
    ];

    if (defaultProject) {
      lines.push(`Default project: \`${defaultProject}\` (auto-applied when you omit the project parameter).`);
    }

    lines.push("", "## Recommended Workflow", "");

    // Starting work section — only include steps for enabled tools
    const startSteps: string[] = [];
    if (isToolEnabled("project_context")) {
      startSteps.push(`**Load context**: Call \`project_context(${defaultProject ? `"${defaultProject}"` : "project"})\` to load hot-tier memories, active decisions, and adopted patterns`);
    }
    if (isToolEnabled("session_start")) {
      startSteps.push(`**Start session**: Call \`session_start(title${defaultProject ? "" : ", project"})\` to begin tracking your work`);
    }
    if (isToolEnabled("decision_check")) {
      startSteps.push(`**Check decisions**: Call \`decision_check(query${defaultProject ? "" : ", project"})\` before making architectural choices`);
    }
    if (isToolEnabled("pattern_search")) {
      startSteps.push("**Find patterns**: Call `pattern_search(query)` to find established conventions before writing code");
    }

    if (startSteps.length > 0) {
      lines.push("When starting work on a project:");
      startSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
      lines.push("");
    }

    // While working section
    const workSteps: string[] = [];
    if (isToolEnabled("memory_store")) {
      workSteps.push("**Store findings**: Call `memory_store(content, metadata)` for important information worth remembering");
    }
    if (isToolEnabled("decision_record")) {
      workSteps.push(`**Record decisions**: Call \`decision_record(title, rationale${defaultProject ? "" : ", project"})\` when making significant architectural choices`);
    }
    if (isToolEnabled("pattern_create")) {
      workSteps.push("**Create patterns**: Call `pattern_create(title, description)` when establishing reusable conventions");
    }

    if (workSteps.length > 0) {
      lines.push("While working:");
      const offset = startSteps.length;
      workSteps.forEach((step, i) => lines.push(`${offset + i + 1}. ${step}`));
      lines.push("");
    }

    // When done section
    if (isToolEnabled("session_end")) {
      const offset = startSteps.length + workSteps.length;
      lines.push("When done:");
      lines.push(`${offset + 1}. **End session**: Call \`session_end(session_id, summary)\` with a summary of what was accomplished`);
      lines.push("");
    }

    // First-time setup — only if project tools are enabled
    if (isToolEnabled("project_register")) {
      lines.push("## First-Time Setup", "");
      lines.push("If the project is not yet registered, start with:");
      lines.push("1. `project_register(slug, name, description, stack)` to register the project");
      lines.push("2. Then follow the workflow above");
      lines.push("");
      if (isToolEnabled("project_list")) {
        lines.push("Use `project_list()` to see existing projects before registering a new one.");
      }
    }

    // Memory-only fallback — if no session/decision/project tools are enabled
    if (startSteps.length === 0 && workSteps.length === 0) {
      lines.push("Use `memory_store(content)` to save important information and `memory_recall(query)` to find relevant memories.");
    }

    const workflowInstructions = lines.join("\n");

    let prependContext = `<memoryrelay-workflow>\n${workflowInstructions}\n</memoryrelay-workflow>`;

    // Auto-recall: search and inject relevant memories
    if (cfg?.autoRecall) {
      try {
        const results = await client.search(
          event.prompt,
          cfg.recallLimit || 5,
          cfg.recallThreshold || 0.3,
        );

        if (results.length > 0) {
          const memoryContext = results.map((r) => `- ${r.memory.content}`).join("\n");

          // Enhanced gateway logging (v0.8.2): Show memory previews
          if (cfg?.debug) {
            const snippets = results
              .map((r) => {
                const preview = r.memory.content.substring(0, 100).replace(/\n/g, ' ');
                const ellipsis = r.memory.content.length > 100 ? '...' : '';
                return `  • [${r.score.toFixed(2)}] ${preview}${ellipsis}`;
              })
              .join('\n');
            api.logger.info?.(
              `memory-memoryrelay: injecting ${results.length} memories into context:\n${snippets}`,
            );
          } else {
            api.logger.info?.(
              `memory-memoryrelay: injecting ${results.length} memories into context`,
            );
          }

          prependContext +=
            `\n\n<relevant-memories>\nThe following memories from MemoryRelay may be relevant:\n${memoryContext}\n</relevant-memories>`;
        }
      } catch (err) {
        api.logger.warn?.(`memory-memoryrelay: recall failed: ${String(err)}`);
      }
    }

    return { prependContext };
  });

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
    `memory-memoryrelay: plugin v0.8.0 loaded (39 tools, autoRecall: ${cfg?.autoRecall}, autoCapture: ${cfg?.autoCapture}, debug: ${debugEnabled})`,
  );

  // ========================================================================
  // CLI Helper Tools (v0.8.0)
  // ========================================================================

  // Register CLI-accessible tools for debugging and diagnostics
  
  // memoryrelay:logs - Get debug logs
  if (debugLogger) {
    api.registerGatewayMethod?.("memoryrelay.logs", async ({ respond, args }) => {
      try {
        const limit = args?.limit || 20;
        const toolName = args?.tool;
        const errorsOnly = args?.errorsOnly || false;

        let logs: LogEntry[];
        if (toolName) {
          logs = debugLogger.getToolLogs(toolName, limit);
        } else if (errorsOnly) {
          logs = debugLogger.getErrorLogs(limit);
        } else {
          logs = debugLogger.getRecentLogs(limit);
        }

        const formatted = DebugLogger.formatTable(logs);
        respond(true, {
          logs,
          formatted,
          count: logs.length,
        });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });
  }

  // memoryrelay:health - Comprehensive health check
  api.registerGatewayMethod?.("memoryrelay.health", async ({ respond }) => {
    try {
      const startTime = Date.now();
      const health = await client.health();
      const healthDuration = Date.now() - startTime;

      const results: any = {
        api: {
          status: health.status,
          endpoint: apiUrl,
          responseTime: healthDuration,
          reachable: true,
        },
        authentication: {
          status: "valid",
          apiKey: apiKey.substring(0, 16) + "...",
        },
        tools: {},
      };

      // Test critical tools
      const toolTests = [
        { name: "memory_store", test: async () => {
          const testMem = await client.store("Plugin health check test", { test: "true" });
          await client.delete(testMem.id);
          return { success: true };
        }},
        { name: "memory_recall", test: async () => {
          await client.search("test", 1, 0.5);
          return { success: true };
        }},
        { name: "memory_list", test: async () => {
          await client.list(1);
          return { success: true };
        }},
      ];

      for (const { name, test } of toolTests) {
        const testStart = Date.now();
        try {
          await test();
          results.tools[name] = {
            status: "working",
            duration: Date.now() - testStart,
          };
        } catch (err) {
          results.tools[name] = {
            status: "error",
            error: String(err),
            duration: Date.now() - testStart,
          };
        }
      }

      // Overall status
      const allToolsWorking = Object.values(results.tools).every(
        (t: any) => t.status === "working"
      );
      results.overall = allToolsWorking ? "healthy" : "degraded";

      respond(true, results);
    } catch (err) {
      respond(false, {
        overall: "unhealthy",
        error: String(err),
      });
    }
  });

  // memoryrelay:metrics - Performance metrics
  if (debugLogger) {
    api.registerGatewayMethod?.("memoryrelay.metrics", async ({ respond }) => {
      try {
        const stats = debugLogger.getStats();
        const allLogs = debugLogger.getAllLogs();

        // Calculate per-tool metrics
        const toolMetrics: Record<string, any> = {};
        for (const log of allLogs) {
          if (!toolMetrics[log.tool]) {
            toolMetrics[log.tool] = {
              calls: 0,
              successes: 0,
              failures: 0,
              totalDuration: 0,
              durations: [],
            };
          }
          const metric = toolMetrics[log.tool];
          metric.calls++;
          if (log.status === "success") {
            metric.successes++;
          } else {
            metric.failures++;
          }
          metric.totalDuration += log.duration;
          metric.durations.push(log.duration);
        }

        // Calculate averages and percentiles
        for (const tool in toolMetrics) {
          const metric = toolMetrics[tool];
          metric.avgDuration = Math.round(metric.totalDuration / metric.calls);
          metric.successRate = Math.round((metric.successes / metric.calls) * 100);
          
          // Calculate p95 and p99
          const sorted = metric.durations.sort((a: number, b: number) => a - b);
          const p95Index = Math.floor(sorted.length * 0.95);
          const p99Index = Math.floor(sorted.length * 0.99);
          metric.p95Duration = sorted[p95Index] || 0;
          metric.p99Duration = sorted[p99Index] || 0;
          
          delete metric.durations; // Don't include raw data in response
        }

        respond(true, {
          summary: stats,
          toolMetrics,
        });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });
  }

  // memoryrelay:test - Test individual tool
  api.registerGatewayMethod?.("memoryrelay.test", async ({ respond, args }) => {
    try {
      const toolName = args?.tool;
      if (!toolName) {
        respond(false, { error: "Missing required argument: tool" });
        return;
      }

      const startTime = Date.now();
      let result: any;
      let error: string | undefined;

      // Test the specified tool
      try {
        switch (toolName) {
          case "memory_store":
            const mem = await client.store("Test memory", { test: "true" });
            await client.delete(mem.id);
            result = { success: true, message: "Memory stored and deleted successfully" };
            break;

          case "memory_recall":
            const searchResults = await client.search("test", 1, 0.5);
            result = { success: true, results: searchResults.length, message: "Search completed" };
            break;

          case "memory_list":
            const list = await client.list(5);
            result = { success: true, count: list.length, message: "List retrieved" };
            break;

          case "project_list":
            const projects = await client.listProjects(5);
            result = { success: true, count: projects.length, message: "Projects listed" };
            break;

          case "memory_health":
            const health = await client.health();
            result = { success: true, status: health.status, message: "Health check passed" };
            break;

          default:
            result = { success: false, message: `Unknown tool: ${toolName}` };
        }
      } catch (err) {
        error = String(err);
        result = { success: false, error };
      }

      const duration = Date.now() - startTime;

      respond(true, {
        tool: toolName,
        duration,
        result,
        error,
      });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });
}
