// src/context/request-context.ts
import type { RequestContext, PluginConfig } from "../pipelines/types.js";
import { resolveNamespace } from "./namespace-router.js";

export interface HookEvent {
  ctx?: {
    sessionKey?: string;
    trigger?: string;
  };
  sessionId?: string;
  channel?: string | number;
  prompt?: string;
}

export function buildRequestContext(event: HookEvent, config: PluginConfig): RequestContext {
  const sessionKey = event.ctx?.sessionKey ?? event.sessionId ?? "";
  const subagentMatch = sessionKey.match(/^agent:([^:]+):subagent:(.+)$/);
  const agentMatch = sessionKey.match(/^agent:([^:]+):(.+)$/);

  const isSubagent = !!subagentMatch;
  const agentId = subagentMatch?.[1] ?? agentMatch?.[1] ?? config.agentId ?? null;
  const parentSessionKey = isSubagent
    ? sessionKey.replace(/:subagent:[^:]+$/, `:${subagentMatch![2]}`)
    : null;

  return Object.freeze({
    sessionKey,
    agentId,
    channel: event.channel != null ? String(event.channel) : null,
    trigger: event.ctx?.trigger ?? null,
    prompt: event.prompt?.trim() ?? "",
    isSubagent,
    parentSessionKey,
    namespace: resolveNamespace(agentId, config.namespace),
    timestamp: Date.now(),
  });
}
