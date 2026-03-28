// src/hooks/activity.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { SessionResolver } from "../context/session-resolver.js";

export interface DebugLoggerLike {
  log(entry: {
    timestamp: string;
    tool: string;
    method: string;
    path: string;
    duration: number;
    status: string;
    error?: unknown;
  }): void;
}

export function registerActivityHooks(
  api: OpenClawPluginApi,
  sessionResolver: SessionResolver,
  debugLogger?: DebugLoggerLike,
): void {
  // Tool observation: no-op, registered for future extensibility
  api.on("before_tool_call", (_event, _ctx) => {
    // Reserved for future: tool blocking, param injection, audit
  });

  // Tool observation: update session activity + log metrics
  api.on("after_tool_call", (event, _ctx) => {
    // Log to debug logger if enabled
    if (debugLogger) {
      debugLogger.log({
        timestamp: new Date().toISOString(),
        tool: event.toolName,
        method: "tool_call",
        path: "",
        duration: event.durationMs || 0,
        status: event.error ? "error" : "success",
        error: event.error,
      });
    }
  });

  // Message processing hooks: activity tracking
  api.on("message_received", (_event, _ctx) => {
    // Activity tracking handled by session resolver
  });

  api.on("message_sending", (_event, _ctx) => {
    // No-op: registered for future extensibility
  });
}
