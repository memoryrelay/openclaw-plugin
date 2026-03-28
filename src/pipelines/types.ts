export interface Memory {
  id: string;
  content: string;
  agent_id: string;
  user_id: string;
  metadata: Record<string, string>;
  entities: string[];
  created_at: string;
  updated_at: string;
  importance?: number;
  tier?: "hot" | "warm" | "cold";
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ScoredMemory {
  memory: Memory;
  finalScore: number;
}

export interface RequestContext {
  readonly sessionKey: string;
  readonly agentId: string | null;
  readonly channel: string | null;
  readonly trigger: string | null;
  readonly prompt: string;
  readonly isSubagent: boolean;
  readonly parentSessionKey: string | null;
  readonly namespace: string;
  readonly timestamp: number;
}

export interface PluginConfig {
  apiKey?: string;
  agentId?: string;
  apiUrl?: string;
  defaultProject?: string;
  autoRecall?: boolean;
  recallLimit?: number;
  recallThreshold?: number;
  excludeChannels?: string[];
  autoCapture?: {
    enabled: boolean;
    tier: "off" | "conservative" | "smart" | "aggressive";
    confirmFirst?: number;
    maxMessageLength?: number;
    stripLargeCodeBlocks?: boolean;
    categories?: {
      credentials?: boolean;
      preferences?: boolean;
      technical?: boolean;
      personal?: boolean;
    };
    blocklist?: string[];
  };
  namespace?: {
    isolateAgents?: boolean;
    subagentPolicy?: "inherit" | "isolate" | "skip";
  };
  ranking?: {
    freshnessBoost?: boolean;
    freshnessWindowHours?: number;
    importanceBoost?: boolean;
    tierBoost?: boolean;
  };
  sessionTimeoutMinutes?: number;
  sessionCleanupIntervalMinutes?: number;
  debug?: boolean;
  verbose?: boolean;
  maxLogEntries?: number;
  logFile?: string;
}

export interface MemoryRelayClient {
  search(query: string, limit: number, threshold: number, opts?: {
    scope?: "session" | "long-term";
    session_id?: string;
    namespace?: string;
  }): Promise<Array<{ memory: Memory; score: number }>>;
  store(content: string, metadata?: Record<string, string>, opts?: Record<string, unknown>): Promise<Memory>;
  list(limit?: number, offset?: number): Promise<Memory[]>;
  getOrCreateSession(
    externalId: string,
    agentId?: string,
    title?: string,
    project?: string,
    metadata?: Record<string, string>,
  ): Promise<{ id: string }>;
  endSession(sessionId: string, summary?: string): Promise<void>;
}

export interface PipelineContext {
  readonly requestCtx: RequestContext;
  readonly config: PluginConfig;
  readonly client: MemoryRelayClient;
}

export interface RecallInput {
  prompt: string;
  memories: Memory[];
  scope: "session" | "long-term" | "all";
  resolvedSessionKey?: string;
  longTerm?: ScoredMemory[];
  session?: ScoredMemory[];
  formatted?: string;
}

export type RecallResult =
  | { action: "continue"; data: RecallInput }
  | { action: "skip" };

export interface RecallStage {
  name: string;
  enabled: (ctx: PipelineContext) => boolean;
  execute: (input: RecallInput, ctx: PipelineContext) => Promise<RecallResult>;
}

export interface CaptureInput {
  messages: ConversationMessage[];
}

export type CaptureResult =
  | { action: "continue"; data: CaptureInput }
  | { action: "skip" };

export interface CaptureStage {
  name: string;
  enabled: (ctx: PipelineContext) => boolean;
  execute: (input: CaptureInput, ctx: PipelineContext) => Promise<CaptureResult>;
}
