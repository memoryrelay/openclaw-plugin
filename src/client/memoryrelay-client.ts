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

/**
 * An ICM (/v2/icm) request the server refused. `code` is the server's machine
 * reason (not_found, no_binding, insufficient_role, scope_missing,
 * required_context_over_budget, ...); 404 on /capabilities means the server
 * has no ICM at all.
 */
export class IcmApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    detail: string,
  ) {
    super(`ICM request failed: ${status} ${code} - ${detail}`);
    this.name = "IcmApiError";
  }
}

/** What a context build is for (server: /v2/icm context build `target`). */
export type IcmBuildTarget =
  | { kind: "entry" }
  | { kind: "route"; id: string }
  | { kind: "stage"; id: string; run_id?: string }
  | { kind: "record"; id: string }
  | { kind: "notes"; task: string; layers?: Array<"A" | "B" | "C"> }
  | { kind: "nodes"; ids?: string[]; paths?: string[]; link_depth?: 0 | 1 }
  | { kind: "impact"; object: string }
  | { kind: "repository"; alias: string; route?: string; stage?: string };

export interface IcmBuildRequest {
  target?: IcmBuildTarget;
  stage?: string;
  project_id?: string;
  runtime?: string;
  token_budget?: number;
  release_id?: string;
  channel?: string;
}

export interface IcmRunStage {
  id: string;
  status: string;
  recorded_state: string;
  attempt: number;
  outputs: string[];
  outputs_digest?: string;
  human_check?: string | null;
  last_note?: string | null;
  artifacts?: Array<{ path: string; revision: number; sha256: string }>;
  [key: string]: unknown;
}

export interface IcmRun {
  run_id: string;
  release_id: string;
  name: string;
  state: string;
  revision: number;
  stages: IcmRunStage[];
  [key: string]: unknown;
}

/** A workspace path as URL segments; refuses empty, `.` and `..` segments. */
function encodeArtifactPath(path: string): string {
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Error("path must be a relative path without empty, . or .. segments");
  }
  return parts.map(encodeURIComponent).join("/");
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
    // /v1/entities/links -> entity
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return "unknown";
    // /v2/icm/workspaces/... -> icm_workspace; /v2/icm/root -> icm_root
    if (parts[0] === "v2" && parts[1] === "icm") {
      return parts.length > 2 ? `icm_${parts[2].replace(/s$/, "").split("?")[0]}` : "icm";
    }

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
            "User-Agent": "openclaw-plugin-memoryrelay-ai/0.25.0",
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
      importance?: number;
      tier?: string;
      scope?: string;
      session_id?: string;
      namespace?: string;
    },
  ): Promise<Memory> {
    // The API keeps metadata verbatim and drops fields it does not know, so the
    // plugin's own scoping (scope, session_id, namespace) lives in metadata where
    // it survives a round trip and can be filtered on.
    const { scope, session_id, namespace, ...apiOptions } = options || {};
    const merged: Record<string, string> = { ...(metadata || {}) };
    if (scope) merged.scope = scope;
    if (session_id) merged.session_id = session_id;
    if (namespace) merged.namespace = namespace;

    const payload: Record<string, unknown> = {
      content,
      agent_id: this.agentId,
      ...apiOptions,
    };
    if (Object.keys(merged).length > 0) payload.metadata = merged;

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
      tier?: string;
      min_importance?: number;
      scope?: string;
      session_id?: string;
      namespace?: string;
    },
  ): Promise<SearchResult[]> {
    const { scope, session_id, namespace, ...searchOptions } = opts || {};
    const metadataFilter: Record<string, string> = {};
    if (scope && scope !== "all") metadataFilter.scope = scope;
    if (session_id) metadataFilter.session_id = session_id;
    if (namespace) metadataFilter.namespace = namespace;

    const body: Record<string, unknown> = {
      query,
      limit: Math.min(Math.max(limit, 1), 100),
      // The API's name for the similarity floor is min_score.
      min_score: threshold,
      agent_id: this.agentId,
      ...searchOptions,
    };
    if (Object.keys(metadataFilter).length > 0) body.metadata_filter = metadataFilter;

    const response = await this.request<{ data: SearchResult[] }>("POST", "/v1/memories/search", body);
    return response.data || [];
  }

  async list(limit: number = 20, offset: number = 0, opts?: { include_embeddings?: boolean }): Promise<Memory[]> {
    // GET /v1/memories answers 422 above 50.
    const cappedLimit = Math.min(Math.max(limit, 1), 50);
    let path = `/v1/memories?limit=${cappedLimit}&offset=${offset}&agent_id=${encodeURIComponent(this.agentId)}`;
    if (opts?.include_embeddings) path += `&include_embeddings=true`;
    const response = await this.request<{ data: Memory[] }>("GET", path);
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
  ): Promise<any> {
    return this.request("POST", "/v1/memories/context", {
      query,
      limit,
      threshold,
      max_tokens: maxTokens,
      agent_id: this.agentId,
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
    return this.request("POST", "/v2/context/build", body);
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
    const limit = 50;

    while (true) {
      const batch = await this.list(limit, offset);
      if (batch.length === 0) break;
      allMemories.push(...batch);
      offset += limit;
      if (batch.length < limit) break;
    }

    return allMemories;
  }

  // --------------------------------------------------------------------------
  // ICM: pinned context workspaces (/v2/icm). Same names as @memoryrelay/mcp-server.
  // --------------------------------------------------------------------------

  private async icmRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const fullPath = `/v2/icm${path}`;
    const toolName = this.extractToolName(fullPath);
    const startTime = Date.now();
    const log = (status: "success" | "error", extra: Record<string, unknown>) => {
      this.debugLogger?.log({
        timestamp: new Date().toISOString(),
        tool: toolName,
        method,
        path: fullPath,
        duration: Date.now() - startTime,
        status,
        requestBody: body,
        ...extra,
      });
    };
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${this.apiUrl}${fullPath}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": "openclaw-plugin-memoryrelay-ai/0.25.0",
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
        },
        REQUEST_TIMEOUT_MS,
      );
    } catch (err) {
      log("error", { error: String(err) });
      this.statusReporter?.recordFailure(toolName, String(err));
      throw err;
    }
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as { code?: string; detail?: string };
      const error = new IcmApiError(response.status, problem.code ?? "http_error", problem.detail ?? response.statusText);
      log("error", { responseStatus: response.status, error: error.message });
      this.statusReporter?.recordFailure(toolName, error.message);
      throw error;
    }
    const result = (await response.json()) as T;
    log("success", { responseStatus: response.status, responseBody: result });
    this.statusReporter?.recordSuccess(toolName);
    return result;
  }

  /** What the server supports for ICM; `{supported: false}` when it has none (404). */
  async icmCapabilities(): Promise<{ supported: boolean; [key: string]: unknown }> {
    try {
      const caps = await this.icmRequest<Record<string, unknown>>("GET", "/capabilities");
      return { supported: true, ...caps };
    } catch (error) {
      if (error instanceof IcmApiError && error.status === 404) return { supported: false };
      throw error;
    }
  }

  async icmListWorkspaces(): Promise<Record<string, unknown>> {
    return this.icmRequest("GET", "/workspaces");
  }

  async icmGetWorkspace(workspaceId: string): Promise<Record<string, unknown>> {
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}`);
  }

  async icmGetRelease(workspaceId: string, releaseId: string): Promise<Record<string, unknown>> {
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}/releases/${encodeURIComponent(releaseId)}`);
  }

  async icmBuildContext(workspaceId: string, request: IcmBuildRequest): Promise<Record<string, unknown>> {
    return this.icmRequest("POST", `/workspaces/${encodeURIComponent(workspaceId)}/context/builds`, request);
  }

  /** Which workspace route a repo/step is bound to; `{match: null}` when none (no fallback). */
  async icmResolve(request: { repo?: string; step?: string }): Promise<Record<string, unknown>> {
    return this.icmRequest("POST", "/resolve", request);
  }

  /** The root: one row per repository the key's workspaces include, with the route bound to `step`. */
  async icmRoot(step?: string): Promise<Record<string, unknown>> {
    return this.icmRequest("GET", step ? `/root?step=${encodeURIComponent(step)}` : "/root");
  }

  /** Resolve a binding and build its route in one call (404 no_binding when unbound). */
  async icmContextFor(request: { repo?: string; step?: string; budget?: number; runtime?: string }): Promise<Record<string, unknown>> {
    return this.icmRequest("POST", "/context/builds:resolve", request);
  }

  async icmGetRun(workspaceId: string, runId: string): Promise<IcmRun> {
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}`);
  }

  async icmGetReceipt(workspaceId: string, receiptId: string): Promise<Record<string, unknown>> {
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}/receipts/${encodeURIComponent(receiptId)}`);
  }

  async icmGetChannel(workspaceId: string, channel: string): Promise<{ channel: string; release_id: string; revision: number }> {
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(channel)}`);
  }

  async icmListRoutes(workspaceId: string, releaseId?: string): Promise<{ release_id: string; entry: string; compiled: boolean; routes: Array<{ id: string; [key: string]: unknown }> }> {
    const query = releaseId ? `?release_id=${encodeURIComponent(releaseId)}` : "";
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}/routes${query}`);
  }

  async icmSourceScan(workspaceId: string): Promise<Record<string, unknown>> {
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}/source/scan`);
  }

  async icmScore(workspaceId: string): Promise<Record<string, unknown>> {
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}/score`);
  }

  async icmMaintenance(workspaceId: string): Promise<Record<string, unknown>> {
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}/maintenance`);
  }

  async icmCreateRun(
    workspaceId: string,
    body: { name: string; release_id?: string; channel?: string; pipeline?: string },
    idempotencyKey: string,
  ): Promise<IcmRun> {
    return this.icmRequest("POST", `/workspaces/${encodeURIComponent(workspaceId)}/runs`, body, { "Idempotency-Key": idempotencyKey });
  }

  async icmTransition(
    workspaceId: string,
    runId: string,
    stage: string,
    body: { action: "start" | "submit"; expected_attempt: number },
  ): Promise<IcmRun> {
    return this.icmRequest(
      "POST",
      `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stage)}/transitions`,
      body,
    );
  }

  async icmPutArtifact(workspaceId: string, runId: string, path: string, content: string, expectedRevision?: number): Promise<Record<string, unknown>> {
    return this.icmRequest(
      "PUT",
      `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/artifacts/${encodeArtifactPath(path)}`,
      { content },
      expectedRevision ? { "If-Match": `"${expectedRevision}"` } : { "If-None-Match": "*" },
    );
  }

  async icmGetArtifact(workspaceId: string, runId: string, path: string): Promise<{ path: string; revision: number; sha256: string; content: string }> {
    return this.icmRequest(
      "GET",
      `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/artifacts/${encodeArtifactPath(path)}`,
    );
  }

  async icmGetDraft(workspaceId: string): Promise<Record<string, unknown>> {
    return this.icmRequest("GET", `/workspaces/${encodeURIComponent(workspaceId)}/draft`);
  }

  async icmImportDraft(workspaceId: string, body: Record<string, unknown>, expectedRevision?: number): Promise<Record<string, unknown>> {
    return this.icmRequest(
      "POST",
      `/workspaces/${encodeURIComponent(workspaceId)}/draft/imports`,
      body,
      expectedRevision !== undefined ? { "If-Match": `"${expectedRevision}"` } : undefined,
    );
  }

  async icmProposeDraft(workspaceId: string, body: { expected_digest: string; title?: string; body?: string }): Promise<Record<string, unknown>> {
    return this.icmRequest("POST", `/workspaces/${encodeURIComponent(workspaceId)}/draft/pull-request`, body);
  }

  async icmAddObservation(
    workspaceId: string,
    receiptId: string,
    body: { event_id: string; kind: string; method: string; payload: Record<string, unknown>; observed_at: string },
  ): Promise<Record<string, unknown>> {
    return this.icmRequest(
      "POST",
      `/workspaces/${encodeURIComponent(workspaceId)}/receipts/${encodeURIComponent(receiptId)}/observations`,
      body,
    );
  }
}
