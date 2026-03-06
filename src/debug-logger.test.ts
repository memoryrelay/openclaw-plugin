/**
 * DebugLogger Tests (Corrected)
 * 
 * Tests matching actual implementation
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { DebugLogger, type LogEntry } from "./debug-logger";
import * as fs from "fs";

vi.mock("fs");

describe("DebugLogger", () => {
  let logger: DebugLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new DebugLogger({
      enabled: true,
      verbose: false,
      maxEntries: 5,
    });
  });

  test("logs are stored when enabled", () => {
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 142,
      status: "success",
    });

    const logs = logger.getAllLogs();
    expect(logs).toHaveLength(1);
  });

  test("logs are not stored when disabled", () => {
    const disabledLogger = new DebugLogger({
      enabled: false,
      verbose: false,
      maxEntries: 5,
    });

    disabledLogger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 142,
      status: "success",
    });

    const logs = disabledLogger.getAllLogs();
    expect(logs).toHaveLength(0);
  });

  test("respects circular buffer limit (FIFO)", () => {
    for (let i = 0; i < 10; i++) {
      logger.log({
        timestamp: new Date(Date.now() + i).toISOString(),
        tool: `tool_${i}`,
        method: "GET",
        path: `/test/${i}`,
        duration: 100,
        status: "success",
      });
    }

    const logs = logger.getAllLogs();
    expect(logs).toHaveLength(5); // maxEntries = 5
    expect(logs[0].tool).toBe("tool_5"); // Oldest kept
    expect(logs[4].tool).toBe("tool_9"); // Newest
  });

  test("getRecentLogs returns last N entries", () => {
    for (let i = 0; i < 3; i++) {
      logger.log({
        timestamp: new Date(Date.now() + i).toISOString(),
        tool: `tool_${i}`,
        method: "GET",
        path: `/test/${i}`,
        duration: 100,
        status: "success",
      });
    }

    const logs = logger.getRecentLogs(2);
    expect(logs).toHaveLength(2);
    expect(logs[0].tool).toBe("tool_1"); // Second-to-last
    expect(logs[1].tool).toBe("tool_2"); // Last
  });

  test("getToolLogs filters by tool name", () => {
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 142,
      status: "success",
    });
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_recall",
      method: "POST",
      path: "/v1/memories/search",
      duration: 78,
      status: "success",
    });
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 156,
      status: "error",
      error: "500",
    });

    const logs = logger.getToolLogs("memory_store", 10);
    expect(logs).toHaveLength(2);
    expect(logs.every(l => l.tool === "memory_store")).toBe(true);
  });

  test("getErrorLogs filters by error status", () => {
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 142,
      status: "success",
    });
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_recall",
      method: "POST",
      path: "/v1/memories/search",
      duration: 78,
      status: "error",
      error: "404",
    });

    const logs = logger.getErrorLogs(10);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("error");
  });

  test("getStats calculates correctly", () => {
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 100,
      status: "success",
    });
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_recall",
      method: "POST",
      path: "/v1/memories/search",
      duration: 200,
      status: "success",
    });
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 150,
      status: "error",
      error: "500",
    });

    const stats = logger.getStats();
    expect(stats.total).toBe(3);
    expect(stats.successful).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.avgDuration).toBe(150); // (100+200+150)/3 = 150
  });

  test("clear() empties logs", () => {
    logger.log({
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 142,
      status: "success",
    });

    logger.clear();
    const logs = logger.getAllLogs();
    expect(logs).toHaveLength(0);
  });

  test("formatEntry creates human-readable output", () => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 142,
      status: "success",
    };

    const formatted = DebugLogger.formatEntry(entry);
    expect(formatted).toContain("memory_store");
    expect(formatted).toContain("142ms");
    expect(formatted).toContain("✓");
  });

  test("formatEntry shows error", () => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      tool: "memory_store",
      method: "POST",
      path: "/v1/memories",
      duration: 156,
      status: "error",
      error: "500 Internal Server Error",
    };

    const formatted = DebugLogger.formatEntry(entry);
    expect(formatted).toContain("memory_store");
    expect(formatted).toContain("156ms");
    expect(formatted).toContain("✗");
    expect(formatted).toContain("500 Internal Server Error");
  });
});
