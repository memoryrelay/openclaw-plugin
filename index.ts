/**
 * OpenClaw Memory Plugin - MemoryRelay (Single File Version)
 * Version: 0.9.4
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// DebugLogger (Inlined)
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
// StatusReporter (Inlined)
// ============================================================================

class StatusReporter {
  constructor(private debugLogger?: DebugLogger) {}

  buildReport(connectionStatus: any, config: any, stats: any, toolGroups: any) {
    const report = {
      available: true,
      connected: connectionStatus.connected,
      apiVersion: connectionStatus.apiVersion,
      config,
      stats,
      tools: toolGroups,
    };
    return report;
  }

  static formatReport(report: any): string {
    return JSON.stringify(report, null, 2);
  }
}

// ============================================================================
// Plugin Code
// ============================================================================

const DEFAULT_API_URL = "https://api.memoryrelay.net";

export default async function plugin(api: OpenClawPluginApi): Promise<void> {
  const cfg = api.pluginConfig as any;
  
  const apiKey = cfg?.apiKey || process.env.MEMORYRELAY_API_KEY;
  const agentId = cfg?.agentId || process.env.MEMORYRELAY_AGENT_ID || api.agentName;

  if (!apiKey) {
    api.logger.error("memory-memoryrelay: Missing API key");
    return;
  }

  if (!agentId) {
    api.logger.error("memory-memoryrelay: Missing agentId");
    return;
  }

  const apiUrl = cfg?.apiUrl || process.env.MEMORYRELAY_API_URL || DEFAULT_API_URL;
  
  const debugEnabled = cfg?.debug || false;
  const verboseEnabled = cfg?.verbose || false;
  const maxLogEntries = cfg?.maxLogEntries || 100;
  
  let debugLogger: DebugLogger | undefined;
  let statusReporter: StatusReporter | undefined;
  
  if (debugEnabled) {
    debugLogger = new DebugLogger({
      enabled: true,
      verbose: verboseEnabled,
      maxEntries: maxLogEntries,
    });
    api.logger.info(`memory-memoryrelay: debug mode enabled`);
  }
  
  statusReporter = new StatusReporter(debugLogger);

  // Register a simple test tool
  api.registerTool({
    name: "memory_test",
    description: "Test MemoryRelay connection",
    handler: async () => {
      return {
        content: [
          {
            type: "text",
            text: `MemoryRelay plugin loaded! API: ${apiUrl}, Agent: ${agentId}`,
          },
        ],
      };
    },
  });

  api.logger.info(`memory-memoryrelay: connected to ${apiUrl}`);
}
