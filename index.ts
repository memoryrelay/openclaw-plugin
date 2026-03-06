/**
 * OpenClaw Memory Plugin - MemoryRelay
 * Version: 0.12.0 (Phase 1 - Adoption Framework)
 *
 * Long-term memory with vector search using MemoryRelay API.
 * Provides auto-recall and auto-capture via lifecycle hooks.
 * Includes: memories, entities, agents, sessions, decisions, patterns, projects.
 * New in v0.12.0: Smart auto-capture, daily stats, CLI commands, onboarding
 *
 * API: https://api.memoryrelay.net
 * Docs: https://memoryrelay.ai
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  calculateStats,
  morningCheck,
  eveningReview,
  shouldRunHeartbeat,
  formatStatsForDisplay,
  type DailyStatsConfig,
  type MemoryStats,
} from "./src/heartbeat/daily-stats.js";
import {
  statsCommand,
  type StatsCommandOptions,
} from "./src/cli/stats-command.js";
import {
  checkFirstRun,
  generateOnboardingPrompt,
  generateSuccessMessage,
  runSimpleOnboarding,
  type OnboardingResult,
} from "./src/onboarding/first-run.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_API_URL = "https://api.memoryrelay.net";
const VALID_HEALTH_STATUSES = ["ok", "healthy", "up"];
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second

// ============================================================================
// DebugLogger (Inlined from src/debug-logger.ts)
// ============================================================================

interface LogEntry {
  timestamp: string;
  tool: string;
  method: string;
  path: string;
  duration: number;
  status: "success" | "error";
  requestBody?: unknown;
  responseBody?: unknown;
  responseStatus?: number;
  error?: string;
  retries?: number;
}

interface DebugLoggerConfig {
  enabled: boolean;
  verbose: boolean;
  maxEntries: number;
}

class DebugLogger {
  private logs: LogEntry[] = [];
  private config: DebugLoggerConfig;

  constructor(config: DebugLoggerConfig) {
    this.config = config;
  }

  log(entry: LogEntry): void {
    if (!this.config.enabled) return;
    this.logs.push(entry);
    if (this.logs.length > this.config.maxEntries) {
      this.logs.shift();
    }
  }

  getRecentLogs(limit: number = 10): LogEntry[] {
    return this.logs.slice(-limit);
  }

  getToolLogs(toolName: string, limit: number = 10): LogEntry[] {
    return this.logs.filter(log => log.tool === toolName).slice(-limit);
  }

  getErrorLogs(limit: number = 10): LogEntry[] {
    return this.logs.filter(log => log.status === "error").slice(-limit);
  }

  getAllLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }

  getStats() {
    const total = this.logs.length;
    const successful = this.logs.filter(l => l.status === "success").length;
    const failed = total - successful;
    const avgDuration = total > 0 ? this.logs.reduce((sum, l) => sum + l.duration, 0) / total : 0;
    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      avgDuration: Math.round(avgDuration),
    };
  }
}

// ============================================================================
// StatusReporter (Inlined from src/status-reporter.ts)
// ============================================================================

interface ToolStatus {
  enabled: number;
  available: number;
  failed: number;
  tools: {
    name: string;
    status: "working" | "error" | "unknown";
    error?: string;
    lastSuccess?: string;
    lastError?: string;
  }[];
}

interface ConnectionStatus {
  status: "connected" | "disconnected" | "degraded";
  endpoint: string;
  lastCheck: string;
  responseTime: number;
}

interface MemoryStats {
  total_memories: number;
  memories_today?: number;
  last_stored?: string;
  search_count_24h?: number;
}

interface PluginConfig {
  agentId: string;
  autoRecall: boolean;
  autoCapture: AutoCaptureConfig; // Updated in v0.12.0
  recallLimit: number;
  recallThreshold: number;
  excludeChannels: string[];
  defaultProject?: string;
}

interface StatusReport {
  connection: ConnectionStatus;
  config: PluginConfig;
  stats: MemoryStats;
  tools: Record<string, ToolStatus>;
  recentCalls: LogEntry[];
  issues: { tool: string; error: string; since: string }[];
}

class StatusReporter {
  private debugLogger?: DebugLogger;
  private toolFailures: Map<string, { error: string; since: string }> = new Map();

  constructor(debugLogger?: DebugLogger) {
    this.debugLogger = debugLogger;
  }

  /**
   * Record tool failure
   */
  recordFailure(toolName: string, error: string): void {
    if (!this.toolFailures.has(toolName)) {
      this.toolFailures.set(toolName, {
        error,
        since: new Date().toISOString(),
      });
    }
  }

  /**
   * Record tool success (clears failure)
   */
  recordSuccess(toolName: string): void {
    this.toolFailures.delete(toolName);
  }

  /**
   * Get known issues
   */
  getIssues(): { tool: string; error: string; since: string }[] {
    return Array.from(this.toolFailures.entries()).map(([tool, data]) => ({
      tool,
      error: data.error,
      since: data.since,
    }));
  }

  /**
   * Build status report
   */
  buildReport(
    connection: ConnectionStatus,
    config: PluginConfig,
    stats: MemoryStats,
    toolGroups: Record<string, string[]>
  ): StatusReport {
    const recentCalls = this.debugLogger
      ? this.debugLogger.getRecentLogs(10)
      : [];

    const tools: Record<string, ToolStatus> = {};

    for (const [group, toolNames] of Object.entries(toolGroups)) {
      const toolStatuses = toolNames.map(name => {
        const logs = this.debugLogger?.getToolLogs(name, 1) || [];
        const lastLog = logs[0];
        const failure = this.toolFailures.get(name);

        let status: "working" | "error" | "unknown" = "unknown";
        let error: string | undefined;
        let lastSuccess: string | undefined;
        let lastError: string | undefined;

        if (lastLog) {
          status = lastLog.status === "success" ? "working" : "error";
          if (lastLog.status === "success") {
            lastSuccess = lastLog.timestamp;
          } else {
            lastError = lastLog.timestamp;
            error = lastLog.error;
          }
        } else if (failure) {
          status = "error";
          error = failure.error;
          lastError = failure.since;
        }

        return {
          name,
          status,
          error,
          lastSuccess,
          lastError,
        };
      });

      const available = toolStatuses.filter(t => t.status === "working").length;
      const failed = toolStatuses.filter(t => t.status === "error").length;

      tools[group] = {
        enabled: toolNames.length,
        available,
        failed,
        tools: toolStatuses,
      };
    }

    return {
      connection,
      config,
      stats,
      tools,
      recentCalls,
      issues: this.getIssues(),
    };
  }

  /**
   * Format status report for CLI display
   */
  static formatReport(report: StatusReport): string {
    const lines: string[] = [];

    // Header
    lines.push("");
    lines.push("MemoryRelay Plugin Status");
    lines.push("━".repeat(50));
    lines.push("");

    // Connection
    lines.push("CONNECTION");
    const connSymbol = report.connection.status === "connected" ? "✓" : "✗";
    lines.push(`  Status:        ${connSymbol} ${report.connection.status}`);
    lines.push(`  Endpoint:      ${report.connection.endpoint}`);
    lines.push(`  Response Time: ${report.connection.responseTime}ms`);
    lines.push(`  Last Check:    ${new Date(report.connection.lastCheck).toLocaleString()}`);
    lines.push("");

    // Configuration
    lines.push("CONFIGURATION");
    lines.push(`  Agent ID:      ${report.config.agentId}`);
    const recallStatus = report.config.autoRecall
      ? `✓ Enabled (limit: ${report.config.recallLimit}, threshold: ${report.config.recallThreshold})`
      : "✗ Disabled";
    lines.push(`  Auto-Recall:   ${recallStatus}`);
    const captureStatus = report.config.autoCapture.enabled
      ? `✓ Enabled (tier: ${report.config.autoCapture.tier})`
      : "✗ Disabled";
    lines.push(`  Auto-Capture:  ${captureStatus}`);
    if (report.config.defaultProject) {
      lines.push(`  Default Project: ${report.config.defaultProject}`);
    }
    lines.push("");

    // Memory Statistics
    lines.push("MEMORY STATISTICS");
    lines.push(`  Total Memories: ${report.stats.total_memories}`);
    if (report.stats.memories_today !== undefined) {
      lines.push(`  Today:          ${report.stats.memories_today}`);
    }
    if (report.stats.last_stored) {
      const lastStored = new Date(report.stats.last_stored);
      const ago = this.formatTimeAgo(lastStored);
      lines.push(`  Last Stored:    ${ago}`);
    }
    if (report.stats.search_count_24h !== undefined) {
      lines.push(`  Searches (24h): ${report.stats.search_count_24h}`);
    }
    lines.push("");

    // Tools Status
    const totalEnabled = Object.values(report.tools).reduce((sum, g) => sum + g.enabled, 0);
    const totalAvailable = Object.values(report.tools).reduce((sum, g) => sum + g.available, 0);
    lines.push(`TOOLS STATUS (${totalAvailable}/${totalEnabled} working)`);

    for (const [groupName, group] of Object.entries(report.tools)) {
      const symbol = group.failed === 0 ? "✓" : group.failed === group.enabled ? "✗" : "⚠";
      const label = groupName.charAt(0).toUpperCase() + groupName.slice(1);
      lines.push(`  ${symbol} ${label}: ${group.available}/${group.enabled} working`);

      // Show failed tools
      const failedTools = group.tools.filter(t => t.status === "error");
      for (const tool of failedTools) {
        lines.push(`    ✗ ${tool.name} (${tool.error})`);
      }
    }
    lines.push("");

    // Recent Activity
    if (report.recentCalls.length > 0) {
      lines.push(`RECENT ACTIVITY (last ${report.recentCalls.length} calls)`);
      for (const call of report.recentCalls.reverse()) {
        const time = new Date(call.timestamp).toLocaleTimeString();
        const status = call.status === "success" ? "✓" : "✗";
        const duration = `${call.duration}ms`;
        lines.push(`  ${time}  ${call.tool.padEnd(18)} ${duration.padStart(6)}  ${status}`);
      }
      lines.push("");
    }

    // Known Issues
    if (report.issues.length > 0) {
      lines.push(`KNOWN ISSUES (${report.issues.length})`);
      for (const issue of report.issues) {
        const since = this.formatTimeAgo(new Date(issue.since));
        lines.push(`  ⚠ ${issue.tool} - ${issue.error} (since ${since})`);
      }
      lines.push("");
    }

    // Footer
    lines.push("For detailed logs, run: openclaw memoryrelay logs");
    lines.push("For troubleshooting: https://github.com/MemoryRelay/api/issues/213");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Format time ago string
   */
  private static formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds} seconds ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  }

  /**
   * Format compact status (for inline display)
   */
  static formatCompact(report: StatusReport): string {
    const totalEnabled = Object.values(report.tools).reduce((sum, g) => sum + g.enabled, 0);
    const totalAvailable = Object.values(report.tools).reduce((sum, g) => sum + g.available, 0);
    const symbol = report.connection.status === "connected" ? "✓" : "✗";
    
    return `MemoryRelay: ${symbol} ${report.connection.status}, ${totalAvailable}/${totalEnabled} tools working`;
  }
}

// Auto-capture configuration types (Phase 1 - Issue #12)
type AutoCaptureTier = "off" | "conservative" | "smart" | "aggressive";

interface AutoCaptureConfig {
  enabled: boolean;
  tier: AutoCaptureTier;
  confirmFirst?: number; // Number of captures to confirm (default: 5)
  categories?: {
    credentials?: boolean;
    preferences?: boolean;
    technical?: boolean;
    personal?: boolean;
  };
  blocklist?: string[]; // Regex patterns to never capture
}

interface MemoryRelayConfig {
  apiKey?: string;
  agentId?: string;
  apiUrl?: string;
  autoCapture?: boolean | AutoCaptureConfig; // Enhanced in v0.12.0
  autoRecall?: boolean;
  recallLimit?: number;
  recallThreshold?: number;
  excludeChannels?: string[];
  defaultProject?: string;
  enabledTools?: string;
  // Daily stats configuration (v0.12.0)
  dailyStats?: DailyStatsConfig;
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
// Auto-Capture Configuration Helpers (Phase 1 - Issue #12)
// ============================================================================

/**
 * Normalize auto-capture config from boolean or object format
 */
function normalizeAutoCaptureConfig(
  config: boolean | AutoCaptureConfig | undefined
): AutoCaptureConfig {
  // Default configuration (smart auto-capture enabled by default in v0.12.0)
  const defaultConfig: AutoCaptureConfig = {
    enabled: true,
    tier: "smart",
    confirmFirst: 5,
    categories: {
      credentials: true,
      preferences: true,
      technical: true,
      personal: false, // Privacy: personal info requires confirmation
    },
    blocklist: [
      // Privacy patterns - never auto-capture
      /password\s*[:=]\s*[^\s]+/i,
      /credit\s*card/i,
      /ssn\s*[:=]/i,
      /social\s*security/i,
    ].map((r) => r.source),
  };

  // Handle legacy boolean config
  if (typeof config === "boolean") {
    return {
      ...defaultConfig,
      enabled: config,
    };
  }

  // Handle undefined (use smart default in v0.12.0+)
  if (config === undefined) {
    return defaultConfig;
  }

  // Merge provided config with defaults
  return {
    enabled: config.enabled ?? defaultConfig.enabled,
    tier: config.tier ?? defaultConfig.tier,
    confirmFirst: config.confirmFirst ?? defaultConfig.confirmFirst,
    categories: {
      ...defaultConfig.categories,
      ...config.categories,
    },
    blocklist: config.blocklist ?? defaultConfig.blocklist,
  };
}

/**
 * Check if content matches any blocklist patterns
 */
function isBlocklisted(content: string, blocklist: string[]): boolean {
  return blocklist.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(content);
    } catch {
      return false; // Invalid regex, skip
    }
  });
}

/**
 * Mask sensitive data in content (API keys, tokens, etc.)
 */
function maskSensitiveData(content: string): string {
  // Mask API keys (show only last 4 chars)
  content = content.replace(
    /\b([a-z]{2,}_)?([a-z]{4,}_)?[a-f0-9]{32,}\b/gi,
    (match) => {
      if (match.length <= 8) return match;
      return `${match.slice(0, 4)}...${match.slice(-4)}`;
    }
  );

  // Mask email addresses (show only domain)
  content = content.replace(
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
    (match) => {
      const domain = match.split("@")[1];
      return `***@${domain}`;
    }
  );

  return content;
}

// ============================================================================
// MemoryRelay API Client (Full Suite)
// ============================================================================

class MemoryRelayClient {
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
export default async function plugin(api: OpenClawPluginApi): Promise<void> {
  const cfg = api.pluginConfig as MemoryRelayConfig | undefined;

  // Fall back to environment variables
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
  const defaultProject = cfg?.defaultProject || process.env.MEMORYRELAY_DEFAULT_PROJECT;
  
  // ========================================================================
  // Debug Logger and Status Reporter (v0.8.0)
  // ========================================================================
  
  const debugEnabled = cfg?.debug || false;
  const verboseEnabled = cfg?.verbose || false;
  const logFile = cfg?.logFile;
  const maxLogEntries = cfg?.maxLogEntries || 100;
  
  let debugLogger: DebugLogger | undefined;
  let statusReporter: StatusReporter | undefined;
  
  if (debugEnabled) {
    debugLogger = new DebugLogger({
      enabled: true,
      verbose: verboseEnabled,
      maxEntries: maxLogEntries,
      logFile: logFile,
    });
    api.logger.info(`memory-memoryrelay: debug mode enabled (verbose: ${verboseEnabled}, maxEntries: ${maxLogEntries})`);
  }
  
  statusReporter = new StatusReporter(debugLogger);
  
  const client = new MemoryRelayClient(apiKey, agentId, apiUrl, debugLogger, statusReporter);

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
      
      // Get config - normalize autoCapture to new format
      const autoCaptureConfig = normalizeAutoCaptureConfig(cfg?.autoCapture);
      
      const pluginConfig = {
        agentId: agentId,
        autoRecall: cfg?.autoRecall ?? true,
        autoCapture: autoCaptureConfig,
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

          api.logger.info?.(
            `memory-memoryrelay: injecting ${results.length} memories into context`,
          );

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
  const autoCaptureConfig = normalizeAutoCaptureConfig(cfg?.autoCapture);
  
  if (autoCaptureConfig.enabled) {
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

        const toCapture = texts.filter((text) => {
          if (!text || !shouldCapture(text)) return false;
          // Check blocklist
          if (isBlocklisted(text, autoCaptureConfig.blocklist || [])) return false;
          return true;
        });
        
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
    `memory-memoryrelay: plugin v0.12.2 loaded (39 tools, autoRecall: ${cfg?.autoRecall}, autoCapture: ${autoCaptureConfig.enabled ? autoCaptureConfig.tier : 'off'}, debug: ${debugEnabled})`,
  );

  // ========================================================================
  // First-Run Onboarding (Phase 1 - Issue #9)
  // ========================================================================

  // Check if this is the first run and auto-onboard if needed
  try {
    const onboardingCheck = await checkFirstRun(async () => {
      const memories = await client.list(1);
      return memories.length;
    });

    if (onboardingCheck.shouldOnboard) {
      // Auto-onboard with simple setup
      await runSimpleOnboarding(
        async (content, metadata) => {
          const memory = await client.store(content, metadata || {});
          return { id: memory.id };
        },
        "Welcome to MemoryRelay! This is your first memory. Use memory_store to add more.",
        autoCaptureConfig.enabled
      );

      const successMsg = generateSuccessMessage(
        "Welcome to MemoryRelay! This is your first memory.",
        autoCaptureConfig.enabled
      );

      api.logger.info?.(`\n${successMsg}`);
    }
  } catch (err) {
    // Don't fail plugin load if onboarding fails
    api.logger.warn?.(`memory-memoryrelay: onboarding check failed: ${String(err)}`);
  }

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

  // memoryrelay:heartbeat - Daily stats check (Phase 1 - Issue #10)
  api.registerGatewayMethod?.("memoryrelay.heartbeat", async ({ respond, args }) => {
    try {
      const dailyStatsConfig: DailyStatsConfig = {
        enabled: cfg?.dailyStats?.enabled ?? true,
        morningTime: cfg?.dailyStats?.morningTime || "09:00",
        eveningTime: cfg?.dailyStats?.eveningTime || "20:00",
      };

      // Check if it's time for a heartbeat
      const heartbeatType = shouldRunHeartbeat(dailyStatsConfig);
      
      if (!heartbeatType) {
        respond(true, {
          type: "none",
          message: "Not scheduled for heartbeat check right now",
        });
        return;
      }

      // Calculate stats
      const memories = await client.list(1000); // Get recent memories
      const stats = await calculateStats(
        async () => memories,
        () => 0 // Recall count not tracked yet (Phase 3)
      );

      // Run appropriate check
      let result;
      if (heartbeatType === "morning") {
        result = await morningCheck(stats);
      } else {
        result = await eveningReview(stats);
      }

      respond(true, {
        type: heartbeatType,
        shouldNotify: result.shouldNotify,
        message: result.message,
        stats: result.stats,
      });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // memoryrelay:onboarding - Show onboarding prompt (Phase 1 - Issue #9)
  api.registerGatewayMethod?.("memoryrelay.onboarding", async ({ respond }) => {
    try {
      const onboardingCheck = await checkFirstRun(async () => {
        const memories = await client.list(1);
        return memories.length;
      });

      const prompt = generateOnboardingPrompt();

      respond(true, {
        isFirstRun: onboardingCheck.isFirstRun,
        alreadyOnboarded: onboardingCheck.state?.completed || false,
        prompt,
      });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // memoryrelay:stats - CLI stats command (Phase 1 - Issue #11)
  api.registerGatewayMethod?.("memoryrelay.stats", async ({ respond, args }) => {
    try {
      const options: StatsCommandOptions = {
        format: (args?.format as "text" | "json") || "text",
        verbose: Boolean(args?.verbose),
      };

      const memories = await client.list(1000);
      const output = await statsCommand(async () => memories, options);

      respond(true, {
        output,
        format: options.format,
      });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

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
