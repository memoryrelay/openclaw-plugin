export interface LocalCacheConfig {
  enabled: boolean;
  dbPath: string;
  syncIntervalMinutes: number;
  maxLocalMemories: number;
  vectorSearch: { enabled: boolean; provider: string };
  ttl: { hot: number; warm: number; cold: number };
}

export interface BufferEntry {
  id: number;
  content: string;
  metadata: Record<string, string>;
  scope: "session" | "long-term";
  session_id?: string;
  namespace: string;
  created_at: string;
  flushed: boolean;
}

export interface SyncState {
  lastPull: string | null;
  lastPush: string | null;
  cursor: string | null;
}

export interface CacheStats {
  totalMemories: number;
  tierBreakdown: { hot: number; warm: number; cold: number };
  bufferDepth: number;
  lastSync: string | null;
  dbSizeBytes: number;
}

export interface LocalMemory {
  id: string;
  remote_id: string | null;
  content: string;
  agent_id: string;
  user_id: string;
  metadata: Record<string, unknown>;
  entities: unknown[];
  importance: number;
  tier: "hot" | "warm" | "cold";
  scope: "session" | "long-term";
  session_id: string | null;
  namespace: string;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  expires_at: string | null;
  embedding: Buffer | null;
}
