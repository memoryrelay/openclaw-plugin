/**
 * Status Reporter for MemoryRelay OpenClaw Plugin
 * 
 * Provides comprehensive status reporting for openclaw status command
 * including connection status, tool breakdown, and recent activity.
 */

import type { LogEntry, DebugLogger } from "./debug-logger";

export interface ToolStatus {
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

export interface ConnectionStatus {
  status: "connected" | "disconnected" | "degraded";
  endpoint: string;
  lastCheck: string;
  responseTime: number;
}

export interface MemoryStats {
  total_memories: number;
  memories_today?: number;
  last_stored?: string;
  search_count_24h?: number;
}

export interface PluginConfig {
  agentId: string;
  autoRecall: boolean;
  autoCapture: boolean;
  recallLimit: number;
  recallThreshold: number;
  excludeChannels: string[];
  defaultProject?: string;
}

export interface StatusReport {
  connection: ConnectionStatus;
  config: PluginConfig;
  stats: MemoryStats;
  tools: Record<string, ToolStatus>;
  recentCalls: LogEntry[];
  issues: { tool: string; error: string; since: string }[];
}

export class StatusReporter {
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
    lines.push(`  Auto-Capture:  ${report.config.autoCapture ? "✓ Enabled" : "✗ Disabled"}`);
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
