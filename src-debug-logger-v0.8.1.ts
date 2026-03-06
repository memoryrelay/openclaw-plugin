/**
 * Debug Logger for MemoryRelay OpenClaw Plugin
 * 
 * Provides comprehensive logging of API calls with request/response capture
 * for troubleshooting and performance analysis.
 */

export interface LogEntry {
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

export interface DebugLoggerConfig {
  enabled: boolean;
  verbose: boolean;
  maxEntries: number;
  logFile?: string;
}

export class DebugLogger {
  private logs: LogEntry[] = [];
  private config: DebugLoggerConfig;
  private fs?: typeof import("fs");

  constructor(config: DebugLoggerConfig) {
    this.config = config;
    
    // Only load fs if logFile is specified
    if (config.logFile) {
      try {
        this.fs = require("fs");
      } catch (err) {
        console.warn("fs module not available, file logging disabled");
      }
    }
  }

  /**
   * Log an API call
   */
  log(entry: LogEntry): void {
    if (!this.config.enabled) return;

    // Add to in-memory buffer
    this.logs.push(entry);
    
    // Trim if exceeds max
    if (this.logs.length > this.config.maxEntries) {
      this.logs.shift();
    }

    // Write to file if configured
    if (this.config.logFile && this.fs) {
      this.writeToFile(entry);
    }
  }

  /**
   * Get recent logs
   */
  getRecentLogs(limit: number = 10): LogEntry[] {
    return this.logs.slice(-limit);
  }

  /**
   * Get logs for specific tool
   */
  getToolLogs(toolName: string, limit: number = 10): LogEntry[] {
    return this.logs
      .filter(log => log.tool === toolName)
      .slice(-limit);
  }

  /**
   * Get error logs only
   */
  getErrorLogs(limit: number = 10): LogEntry[] {
    return this.logs
      .filter(log => log.status === "error")
      .slice(-limit);
  }

  /**
   * Get all logs
   */
  getAllLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Clear logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Get statistics
   */
  getStats() {
    const total = this.logs.length;
    const successful = this.logs.filter(l => l.status === "success").length;
    const failed = total - successful;
    const avgDuration = total > 0
      ? this.logs.reduce((sum, l) => sum + l.duration, 0) / total
      : 0;

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      avgDuration: Math.round(avgDuration),
    };
  }

  /**
   * Write log entry to file
   */
  private writeToFile(entry: LogEntry): void {
    if (!this.fs || !this.config.logFile) return;

    try {
      const logLine = JSON.stringify(entry) + "\n";
      this.fs.appendFileSync(this.config.logFile, logLine, "utf8");
    } catch (err) {
      console.error(`Failed to write debug log: ${err}`);
    }
  }

  /**
   * Format log entry for display
   */
  static formatEntry(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const status = entry.status === "success" ? "✓" : "✗";
    const duration = `${entry.duration}ms`;
    
    let output = `${timestamp}  ${entry.tool.padEnd(20)} ${duration.padStart(6)}  ${status}`;
    
    if (entry.error) {
      output += `\n          Error: ${entry.error}`;
    }
    
    if (entry.retries && entry.retries > 0) {
      output += ` (${entry.retries} retries)`;
    }
    
    return output;
  }

  /**
   * Format logs as table
   */
  static formatTable(logs: LogEntry[]): string {
    if (logs.length === 0) {
      return "No logs available";
    }

    const lines = [
      "TIMESTAMP          TOOL                    DURATION  STATUS  ERROR",
      "━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━  ━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];

    for (const entry of logs) {
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      const status = entry.status === "success" ? "✓" : "✗";
      const duration = `${entry.duration}ms`;
      const error = entry.error ? entry.error.substring(0, 30) : "";
      
      lines.push(
        `${timestamp}  ${entry.tool.padEnd(20)}  ${duration.padStart(8)}  ${status.padEnd(6)}  ${error}`
      );
    }

    return lines.join("\n");
  }
}
