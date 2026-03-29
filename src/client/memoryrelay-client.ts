/**
 * MemoryRelay API Client
 *
 * Extracted from index.ts — provides typed HTTP access to the MemoryRelay API
 * with timeout, retry, and debug/status instrumentation.
 */

import type { DebugLogger } from "../debug-logger.js";
import type { StatusReporter } from "../status-reporter.js";
import type { Memory, MemoryRelayClient as IMemoryRelayClient } from "../pipelines/types.js";

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_API_URL = "https://api.memoryrelay.net";
export const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
export const MAX_RETRIES = 3;
export const INITIAL_RETRY_DELAY_MS = 1000; // 1 second
export const VALID_HEALTH_STATUSES = ["ok", "healthy", "up"];

// ============================================================================
// Types
// ============================================================================

// Re-export Memory from canonical source
export type { Memory } from "../pipelines/types.js";

export interface SearchResult {
  memory: Memory;
  score: number;
}

export interface Stats {
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
export async function fetchWithTimeout(
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

export class MemoryRelayClient implements IMemoryRelayClient {
  private debugLogger?: DebugLogger;
  private statusReporter?: StatusReporter;

  constructor(
    private readonly apiKey: string,
    private readonly agentId: string,
    private readonly apiUrl: string = DEFAULT_API_URL,
    debugLogger?: DebugLogger,
    statusReporter?: StatusReporter,
  ) {
    this.debugLogger = debugLogger;
    this.statusReporter = statusReporter;
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
            "User-Agent": "openclaw-memory-memoryrelay/0.17.1",
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
      scope?: string;
    },
  ): Promise<Memory> {
    // Extract session_id from metadata if present and move to top-level
    const { session_id, ...cleanMetadata } = metadata || {};

    const payload: any = {
      content,
      agent_id: this.agentId,
      ...options,
    };

    // Only include metadata if there's something left after extracting session_id
    if (Object.keys(cleanMetadata).length > 0) {
      payload.metadata = cleanMetadata;
    }

    // Add session_id as top-level parameter if provided
    if (session_id) {
      payload.session_id = session_id;
    }

    return this.request<Memory>("POST", "/v1/memories", payload);
  }

  async search(
    query: string,
    limit: number = 5,
    threshold: number = 0.3,
    opts?: {
      include_confidential?: boolean;
      include_archived?: boolean;
      compress?: boolean;
      max_context_tokens?: number;
      project?: string;
      tier?: string;
      min_importance?: number;
      scope?: string;
      session_id?: string;
      namespace?: string;
    },
  ): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      threshold: String(threshold),
    });
    if (opts?.scope) params.set("scope", opts.scope);
    if (opts?.session_id) params.set("session_id", opts.session_id);
    if (opts?.namespace) params.set("namespace", opts.namespace);

    // Build POST body from remaining options (existing search contract)
    const { scope, session_id, namespace, ...searchOptions } = opts || {};

    const response = await this.request<{ data: SearchResult[] }>(
      "POST",
      `/v1/memories/search?${params.toString()}`,
      {
        query,
        limit,
        threshold,
        agent_id: this.agentId,
        ...searchOptions,
      },
    );
    return response.data || [];
  }

  async list(limit: number = 20, offset: number = 0, opts?: { scope?: string }): Promise<Memory[]> {
    const cappedLimit = Math.min(limit, 100);
    let path = `/v1/memories?limit=${cappedLimit}&offset=${offset}&agent_id=${encodeURIComponent(this.agentId)}`;
    if (opts?.scope) path += `&scope=${encodeURIComponent(opts.scope)}`;
    const response = await this.request<{ data: Memory[] }>(
      "GET",
      path,
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
  // V2 Async API Methods (v0.15.0)
  // --------------------------------------------------------------------------

  async storeAsync(
    content: string,
    metadata?: Record<string, string>,
    project?: string,
    importance?: number,
    tier?: string,
    webhook_url?: string,
  ): Promise<{ id: string; status: string; job_id: string; estimated_completion_seconds: number }> {
    if (!content || content.length === 0 || content.length > 50000) {
      throw new Error("Content must be between 1 and 50,000 characters");
    }
    const body: Record<string, unknown> = {
      content,
      agent_id: this.agentId,
    };
    if (metadata) body.metadata = metadata;
    if (project) body.project = project;
    if (importance != null) body.importance = importance;
    if (tier) body.tier = tier;
    if (webhook_url) body.webhook_url = webhook_url;
    return this.request("POST", "/v2/memories", body);
  }

  async getMemoryStatus(memoryId: string): Promise<{
    id: string;
    status: "pending" | "processing" | "ready" | "failed";
    created_at: string;
    updated_at: string;
    error?: string;
  }> {
    return this.request("GET", `/v2/memories/${memoryId}/status`);
  }

  async buildContextV2(
    query: string,
    options?: {
      maxMemories?: number;
      maxTokens?: number;
      aiEnhanced?: boolean;
      searchMode?: "semantic" | "hybrid" | "keyword";
      excludeMemoryIds?: string[];
    },
  ): Promise<any> {
    const body: Record<string, unknown> = {
      query,
      agent_id: this.agentId,
    };
    if (options?.maxMemories != null) body.max_memories = options.maxMemories;
    if (options?.maxTokens != null) body.max_tokens = options.maxTokens;
    if (options?.aiEnhanced != null) body.ai_enhanced = options.aiEnhanced;
    if (options?.searchMode) body.search_mode = options.searchMode;
    if (options?.excludeMemoryIds) body.exclude_memory_ids = options.excludeMemoryIds;
    return this.request("POST", "/v2/context", body);
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

  async getOrCreateSession(
    external_id: string,
    agent_id?: string,
    title?: string,
    project?: string,
    metadata?: Record<string, string>,
  ): Promise<any> {
    return this.request("POST", "/v1/sessions/get-or-create", {
      external_id,
      agent_id: agent_id || this.agentId,
      title,
      project,
      metadata,
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
    metadata?: Record<string, string>,
  ): Promise<any> {
    return this.request("POST", "/v1/decisions", {
      title,
      rationale,
      alternatives,
      project_slug: project,
      tags,
      status,
      metadata,
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
      `/v1/agents/${encodeURIComponent(this.agentId)}/stats`,
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
