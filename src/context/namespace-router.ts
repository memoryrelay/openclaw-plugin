// src/context/namespace-router.ts
export interface NamespaceConfig {
  isolateAgents?: boolean;
  subagentPolicy?: "inherit" | "isolate" | "skip";
}

const DEFAULTS: Required<NamespaceConfig> = {
  isolateAgents: false,
  subagentPolicy: "inherit",
};

export function resolveNamespace(
  agentId: string | null,
  nsConfig: NamespaceConfig | undefined,
): string {
  const config = { ...DEFAULTS, ...nsConfig };
  if (!config.isolateAgents || !agentId) return "default";
  return `agent:${agentId}`;
}
