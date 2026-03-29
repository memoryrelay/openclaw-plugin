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

export interface StoreOptions {
  deduplicate?: boolean;
  dedup_threshold?: number;
  project?: string;
  importance?: number;
  tier?: string;
  scope?: string;
  session_id?: string;
}

export interface SearchOptions {
  include_confidential?: boolean;
  include_archived?: boolean;
  compress?: boolean;
  max_context_tokens?: number;
  project?: string;
  tier?: string;
  min_importance?: number;
  scope?: string;
  session_id?: string;
  namespace?: string;
}

export interface MemoryRelayClient {
  search(query: string, limit?: number, threshold?: number, opts?: SearchOptions): Promise<Array<{ memory: Memory; score: number }>>;
  store(content: string, metadata?: Record<string, string>, options?: StoreOptions): Promise<Memory>;
  list(limit?: number, offset?: number, opts?: { scope?: string }): Promise<Memory[]>;
  getOrCreateSession(
    externalId: string,
    agentId?: string,
    title?: string,
    project?: string,
    metadata?: Record<string, string>,
  ): Promise<{ id: string }>;
  endSession(sessionId: string, summary?: string): Promise<void>;
}

export interface SessionResolverLike {
  resolve(requestCtx: RequestContext): Promise<{ sessionId: string; externalId: string }>;
}

export interface LocalCacheLike {
  bufferWrite(content: string, metadata: Record<string, unknown>): string;
  bufferDepth(): number;
}

export interface PipelineContext {
  readonly requestCtx: RequestContext;
  readonly config: PluginConfig;
  readonly client: MemoryRelayClient;
  readonly sessionResolver?: SessionResolverLike;
  readonly localCache?: LocalCacheLike;
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
  | { action: "continue"; data: CaptureInput; buffered?: boolean }
  | { action: "skip" };

export interface CaptureStage {
  name: string;
  enabled: (ctx: PipelineContext) => boolean;
  execute: (input: CaptureInput, ctx: PipelineContext) => Promise<CaptureResult>;
}
