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
  embedding?: Buffer | null;
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
  autoRecall?: boolean;
  recallLimit?: number;
  recallThreshold?: number;
  /** "saliency" (default): grouped, tagged, with a hint tied to the prompt; "flat": one bullet per memory. */
  recallFormat?: "saliency" | "flat";
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
  saliency?: {
    minContentLength?: number;
    noisePatterns?: string[];
  };
  vectorSearch?: {
    enabled?: boolean;
    provider?: string;
  };
  syncIntervalMinutes?: number;
  icm?: IcmConfig;
  debug?: boolean;
  verbose?: boolean;
  maxLogEntries?: number;
  logFile?: string;
}

/**
 * ICM: pinned context workspaces (/v2/icm). `repo` and `step` name the binding
 * a person made in MemoryRelay for this agent; when unset the server resolves
 * from the key alone. `autoContext` injects the bound route's context before
 * each agent turn (default true). `corpus` makes the live files of the
 * workspaces searchable through OpenClaw's memory_search (default true).
 */
export interface IcmConfig {
  enabled?: boolean;
  autoContext?: boolean;
  repo?: string;
  step?: string;
  tokenBudget?: number;
  runtime?: string;
  /** ICM files as a corpus of memory_search/memory_get (needs memorySupplement). */
  corpus?: IcmCorpusConfig;
}

export interface IcmCorpusConfig {
  /** Default true. */
  enabled?: boolean;
  /** Workspace slugs or ids to include; every workspace the key can read when empty. */
  workspaces?: string[];
}

export interface StoreOptions {
  deduplicate?: boolean;
  dedup_threshold?: number;
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
  tier?: string;
  min_importance?: number;
  scope?: string;
  session_id?: string;
  namespace?: string;
}

export interface MemoryRelayClient {
  search(query: string, limit?: number, threshold?: number, opts?: SearchOptions): Promise<Array<{ memory: Memory; score: number }>>;
  store(content: string, metadata?: Record<string, string>, options?: StoreOptions): Promise<Memory>;
  list(limit?: number, offset?: number, opts?: { include_embeddings?: boolean }): Promise<Memory[]>;
}

export interface EmbeddingService {
  generateQuery(text: string): Promise<Float32Array>;
}

export interface LocalCacheLike {
  bufferWrite(content: string, metadata: Record<string, unknown>): string;
  bufferDepth(): number;
  count(): number;
  search(query: string, opts?: { limit?: number; scope?: string; sessionId?: string; namespace?: string; queryEmbedding?: Float32Array | null }): Array<{
    id: string; content: string; agent_id: string; user_id: string;
    metadata: Record<string, unknown>; entities: unknown[];
    importance: number; tier: "hot" | "warm" | "cold";
    created_at: string; updated_at: string;
  }>;
  getSyncState(): { lastPull: string | null; lastPush: string | null; cursor: string | null };
  close(): void;
}

export interface SyncDaemonLike {
  start(): void;
  stop(): void;
  pull(): Promise<{ added: number; updated: number }>;
  isRunning(): boolean;
}

export interface PipelineContext {
  readonly requestCtx: RequestContext;
  readonly config: PluginConfig;
  readonly client: MemoryRelayClient;
  readonly localCache?: LocalCacheLike;
  readonly syncDaemon?: SyncDaemonLike;
  readonly embeddingService?: EmbeddingService;
}

export interface RecallInput {
  prompt: string;
  memories: Memory[];
  scope: "session" | "long-term" | "all";
  resolvedSessionKey?: string;
  longTerm?: ScoredMemory[];
  session?: ScoredMemory[];
  source?: "local" | "api";
  formatted?: string;
  queryEmbedding?: Float32Array | null;
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
