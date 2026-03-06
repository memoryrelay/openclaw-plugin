/**
 * StatusReporter Tests (Simplified)
 * 
 * Tests matching actual implementation
 */

import { describe, test, expect, beforeEach } from "vitest";
import { StatusReporter, type ConnectionStatus, type PluginConfig, type MemoryStats } from "./status-reporter";
import { DebugLogger } from "./debug-logger";

describe("StatusReporter", () => {
  let reporter: StatusReporter;
  let debugLogger: DebugLogger;
  let mockConnection: ConnectionStatus;
  let mockConfig: PluginConfig;
  let mockStats: MemoryStats;

  beforeEach(() => {
    debugLogger = new DebugLogger({
      enabled: true,
      verbose: false,
      maxEntries: 100,
    });
    reporter = new StatusReporter(debugLogger);

    mockConnection = {
      status: "connected",
      endpoint: "https://api.memoryrelay.net",
      lastCheck: new Date().toISOString(),
      responseTime: 45,
    };

    mockConfig = {
      agentId: "test-agent",
      autoRecall: true,
      autoCapture: false,
      recallLimit: 5,
      recallThreshold: 0.3,
      excludeChannels: [],
    };

    mockStats = {
      total_memories: 100,
    };
  });

  test("records and clears tool failures", () => {
    reporter.recordFailure("memory_store", "500 Error");
    let issues = reporter.getIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].tool).toBe("memory_store");

    reporter.recordSuccess("memory_store");
    issues = reporter.getIssues();
    expect(issues).toHaveLength(0);
  });

  test("buildReport creates status report", () => {
    const toolGroups = {
      "Core Memory": ["memory_store", "memory_recall"],
      "Projects": ["project_list"],
    };

    const report = reporter.buildReport(
      mockConnection,
      mockConfig,
      mockStats,
      toolGroups,
    );

    expect(report.connection).toEqual(mockConnection);
    expect(report.config).toEqual(mockConfig);
    expect(report.stats).toEqual(mockStats);
    expect(report.tools["Core Memory"]).toBeDefined();
    expect(report.tools["Projects"]).toBeDefined();
  });

  test("buildReport includes tool status from debug logs", () => {
    debugLogger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 142,
      status: "success",
    });

    const toolGroups = {
      "Core Memory": ["memory_store"],
    };

    const report = reporter.buildReport(
      mockConnection,
      mockConfig,
      mockStats,
      toolGroups,
    );

    const memoryTools = report.tools["Core Memory"];
    expect(memoryTools.available).toBe(1);
    expect(memoryTools.failed).toBe(0);
    expect(memoryTools.tools[0].status).toBe("working");
  });

  test("buildReport shows failed tools", () => {
    debugLogger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 156,
      status: "error",
      error: "500 Internal Server Error",
    });

    const toolGroups = {
      "Core Memory": ["memory_store"],
    };

    const report = reporter.buildReport(
      mockConnection,
      mockConfig,
      mockStats,
      toolGroups,
    );

    const memoryTools = report.tools["Core Memory"];
    expect(memoryTools.available).toBe(0);
    expect(memoryTools.failed).toBe(1);
    expect(memoryTools.tools[0].status).toBe("error");
    expect(memoryTools.tools[0].error).toBe("500 Internal Server Error");
  });

  test("buildReport includes recent calls", () => {
    debugLogger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 142,
      status: "success",
    });

    const toolGroups = {
      "Core Memory": ["memory_store"],
    };

    const report = reporter.buildReport(
      mockConnection,
      mockConfig,
      mockStats,
      toolGroups,
    );

    expect(report.recentCalls).toHaveLength(1);
    expect(report.recentCalls[0].tool).toBe("memory_store");
  });

  test("formatReport creates human-readable output", () => {
    const toolGroups = {
      "Core Memory": ["memory_store", "memory_recall"],
    };

    const report = reporter.buildReport(
      mockConnection,
      mockConfig,
      mockStats,
      toolGroups,
    );

    const formatted = StatusReporter.formatReport(report);
    expect(formatted).toContain("MemoryRelay Plugin Status");
    expect(formatted).toContain("connected");
    expect(formatted).toContain("Core Memory");
  });

  test("formatCompact creates brief output", () => {
    const toolGroups = {
      "Core Memory": ["memory_store"],
    };

    const report = reporter.buildReport(
      mockConnection,
      mockConfig,
      mockStats,
      toolGroups,
    );

    const compact = StatusReporter.formatCompact(report);
    expect(compact).toContain("connected");
    expect(compact.length).toBeLessThan(200); // Should be brief
  });

  test("handles disconnected status", () => {
    mockConnection.status = "disconnected";

    const toolGroups = {
      "Core Memory": ["memory_store"],
    };

    const report = reporter.buildReport(
      mockConnection,
      mockConfig,
      mockStats,
      toolGroups,
    );

    expect(report.connection.status).toBe("disconnected");
    const formatted = StatusReporter.formatReport(report);
    expect(formatted).toContain("disconnected");
  });

  test("includes issues in report", () => {
    reporter.recordFailure("memory_batch_store", "500 Error");

    const toolGroups = {
      "Core Memory": ["memory_batch_store"],
    };

    const report = reporter.buildReport(
      mockConnection,
      mockConfig,
      mockStats,
      toolGroups,
    );

    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].tool).toBe("memory_batch_store");
  });
});
