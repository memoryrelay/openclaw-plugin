# v0.17.0 Implementation Plan: Local SQLite Cache Layer

**Epic:** [#62 — Local SQLite cache layer: hybrid local/remote memory for speed and resilience](https://github.com/memoryrelay/openclaw-plugin/issues/62)
**Target:** v0.17.0
**Complexity:** XL
**Date:** 2026-03-29

---

## Table of Contents

1. [Architecture Decisions](#1-architecture-decisions)
2. [File Structure](#2-file-structure)
3. [MemorySearchManager Interface](#3-memorysearchmanager-interface)
4. [Phase Breakdown](#4-phase-breakdown)
5. [Risk Analysis](#5-risk-analysis)
6. [Sub-issues to Create](#6-sub-issues-to-create)
7. [Test Strategy](#7-test-strategy)

---

## 1. Architecture Decisions

### 1.1 SQLite Library: `better-sqlite3` (Recommended)

| Criterion | `better-sqlite3` | `node:sqlite` (Node.js 22.5+) |
|-----------|------------------|-------------------------------|
| Stability | Production-proven, 8+ years | Experimental (`node --experimental-sqlite`) |
| API | Synchronous, zero-overhead for reads | Async-first, overhead on hot path |
| Extensions | Full support (`sqlite-vec`, FTS5) | Limited extension loading |
| `package.json` engines | Currently `>=20.0.0` | Would require `>=22.5.0` |
| Native bindings | Prebuilt for all platforms | Built into Node binary |
| Risk | Native addon install failures | API surface may change between Node releases |

**Decision:** Use `better-sqlite3`.

**Rationale:**
- Synchronous API is ideal for the recall hot path (<5ms target). No async overhead.
- Full `sqlite-vec` extension support for Phase 3 vector search.
- Our `engines` field says `>=20.0.0`; adopting `node:sqlite` would force `>=22.5.0` and break existing users.
- `better-sqlite3` is the same library OpenClaw's own `MemoryIndexManager` uses internally (confirmed in `pi-embedded-BaSvmUpW.js`).

### 1.2 Schema Design

```sql
-- Core memories table with FTS5 for text search
CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,           -- UUID, matches API memory ID
  remote_id     TEXT UNIQUE,                -- API-side memory ID (for sync tracking)
  content       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  user_id       TEXT DEFAULT '',
  metadata      TEXT DEFAULT '{}',          -- JSON blob
  entities      TEXT DEFAULT '[]',          -- JSON array
  importance    REAL DEFAULT 0.5,
  tier          TEXT DEFAULT 'warm'         -- hot | warm | cold
                  CHECK(tier IN ('hot', 'warm', 'cold')),
  scope         TEXT DEFAULT 'long-term'    -- session | long-term
                  CHECK(scope IN ('session', 'long-term')),
  session_id    TEXT,                       -- NULL for long-term memories
  namespace     TEXT DEFAULT 'default',
  created_at    TEXT NOT NULL,              -- ISO 8601
  updated_at    TEXT NOT NULL,              -- ISO 8601
  synced_at     TEXT,                       -- NULL = never synced to API
  expires_at    TEXT,                       -- TTL expiration timestamp
  embedding     BLOB                        -- sqlite-vec float32 vector (Phase 3)
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  metadata,
  content=memories,
  content_rowid=rowid
);

-- FTS triggers
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories
  BEGIN INSERT INTO memories_fts(rowid, content, metadata) VALUES (new.rowid, new.content, new.metadata); END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories
  BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, metadata) VALUES ('delete', old.rowid, old.content, old.metadata); END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories
  BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, metadata) VALUES ('delete', old.rowid, old.content, old.metadata);
        INSERT INTO memories_fts(rowid, content, metadata) VALUES (new.rowid, new.content, new.metadata); END;

-- Session buffer for async capture writes
CREATE TABLE IF NOT EXISTS session_buffer (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content     TEXT NOT NULL,
  metadata    TEXT DEFAULT '{}',          -- JSON blob
  scope       TEXT DEFAULT 'long-term',
  session_id  TEXT,
  namespace   TEXT DEFAULT 'default',
  created_at  TEXT NOT NULL,
  flushed     INTEGER DEFAULT 0           -- 0 = pending, 1 = flushed to API
);

-- Sync state tracking
CREATE TABLE IF NOT EXISTS sync_state (
  key         TEXT PRIMARY KEY,           -- 'last_pull', 'last_push', 'cursor'
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Cache metadata
CREATE TABLE IF NOT EXISTS cache_meta (
  key         TEXT PRIMARY KEY,           -- 'schema_version', 'agent_id', 'created_at'
  value       TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memories_agent     ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_tier      ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_scope     ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_session   ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_namespace  ON memories(namespace);
CREATE INDEX IF NOT EXISTS idx_memories_expires   ON memories(expires_at);
CREATE INDEX IF NOT EXISTS idx_memories_synced    ON memories(synced_at);
CREATE INDEX IF NOT EXISTS idx_memories_updated   ON memories(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_buffer_flushed     ON session_buffer(flushed, created_at);
```

### 1.3 Memory-Core Compatibility

OpenClaw's status scanner (`status.scan.json-core-Dq58GPqJ.js`) calls `resolveSharedMemoryStatusSnapshot()` which:

1. Checks `memoryPlugin.slot === "memory-core"` (our plugin occupies the memory slot)
2. Calls `existsSync(resolvedMemory.store.path)` — needs `~/.openclaw/memory/{agentId}.sqlite` to exist
3. Calls `manager.probeVectorAvailability()` — must return `boolean`
4. Calls `manager.status()` — must return a `MemoryProviderStatus` object
5. Calls `manager.close()` — cleanup

The `status()` return shape (from `pi-embedded-BaSvmUpW.js:152096`):

```typescript
interface MemoryProviderStatus {
  backend: string;                         // "builtin" or "plugin"
  files: number;                           // count of source files
  chunks: number;                          // count of indexed chunks
  dirty: boolean;                          // pending re-index
  workspaceDir: string;
  dbPath: string;                          // path to SQLite file
  provider: string;                        // embedding provider ID
  model: string | undefined;
  requestedProvider: string;
  sources: string[];
  extraPaths: string[];
  sourceCounts: Array<{ source: string; files: number; chunks: number }>;
  cache: { enabled: boolean; entries?: number; maxEntries?: number };
  fts: { enabled: boolean; available: boolean; error?: string };
  vector: { enabled: boolean; available?: boolean; extensionPath?: string; loadError?: string; dims?: number };
  batch: { enabled: boolean; failures: number; limit: number; /* ... */ };
  fallback?: { from: string; reason: string };
  custom: Record<string, unknown>;
}
```

**For our plugin**, we provide a simplified but compatible status object. The scanner spreads `{ agentId, ...status }` so all fields must be present. The display line reads `files` and `chunks` counts plus the `vector` state.

### 1.4 Sync Strategy

```
┌─────────────────────────────────────────────────┐
│                  SyncDaemon                      │
│                                                  │
│  Pull (every N min):                            │
│    GET /v1/memories?agent_id=X&since={cursor}   │
│    → upsert into local memories table           │
│    → update sync_state.last_pull + cursor        │
│                                                  │
│  Push (every N min):                            │
│    SELECT * FROM session_buffer WHERE flushed=0  │
│    → POST /v1/memories for each                  │
│    → INSERT into memories with remote_id         │
│    → UPDATE session_buffer SET flushed=1         │
│    → update sync_state.last_push                 │
│                                                  │
│  Conflict Resolution:                            │
│    - Existing memory (same remote_id):           │
│      API version wins (overwrite local)          │
│    - New local memory (no remote_id):            │
│      Push to API, store returned ID              │
│    - Deleted on API:                             │
│      Remove from local on next pull              │
│                                                  │
│  Backoff:                                        │
│    On API error: 1min → 5min → 30min → 30min    │
│    Reset on success                              │
└─────────────────────────────────────────────────┘
```

### 1.5 TTL Eviction Strategy

| Tier | TTL (hours) | Eviction Rule |
|------|-------------|---------------|
| hot  | 72 (3 days) | Evict when `expires_at < NOW` AND tier = 'hot' |
| warm | 168 (7 days) | Evict when `expires_at < NOW` AND tier = 'warm' |
| cold | 720 (30 days) | Evict when `expires_at < NOW` AND tier = 'cold' |

Eviction runs:
- On `SyncDaemon` pull cycle (piggyback, no extra timer)
- On `LocalCache.open()` (startup cleanup)
- Respects `maxLocalMemories` config cap — if exceeded, evict oldest cold first, then warm

```sql
-- Eviction query (run during sync)
DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < datetime('now');

-- Cap enforcement
DELETE FROM memories WHERE id IN (
  SELECT id FROM memories
  ORDER BY
    CASE tier WHEN 'cold' THEN 0 WHEN 'warm' THEN 1 WHEN 'hot' THEN 2 END,
    updated_at ASC
  LIMIT MAX(0, (SELECT COUNT(*) FROM memories) - :maxLocalMemories)
);
```

---

## 2. File Structure

### New Files

| File | Purpose |
|------|---------|
| `src/cache/local-cache.ts` | `LocalCache` class: SQLite wrapper, CRUD, FTS5 search, TTL eviction |
| `src/cache/sync-daemon.ts` | `SyncDaemon` class: background pull/push, backoff, conflict resolution |
| `src/cache/schema.ts` | SQL schema constants, migration logic, version checks |
| `src/cache/memory-manager.ts` | `PluginMemoryManager`: wraps `LocalCache` to satisfy OpenClaw's `MemorySearchManager` interface |
| `src/cache/types.ts` | Cache-specific types: `LocalCacheConfig`, `SyncState`, `BufferEntry`, `CacheStats` |
| `tests/cache/local-cache.test.ts` | Unit tests for LocalCache CRUD, FTS5, TTL eviction |
| `tests/cache/sync-daemon.test.ts` | Unit tests for SyncDaemon pull/push/conflict/backoff |
| `tests/cache/memory-manager.test.ts` | Unit tests for PluginMemoryManager status/probe/close |
| `tests/cache/schema.test.ts` | Schema creation, migration, version check tests |
| `tests/integration/local-cache-pipeline.test.ts` | End-to-end: recall/capture through local cache |

### Modified Files

| File | Changes |
|------|---------|
| `package.json` | Add `better-sqlite3` + `@types/better-sqlite3` dependencies, bump version to `0.17.0` |
| `src/pipelines/types.ts` | Add `LocalCacheConfig` to `PluginConfig`, add `localCache?: LocalCache` to `PipelineContext` |
| `src/pipelines/recall/search.ts` | Local-first search: query `LocalCache.search()` then fall back to API |
| `src/pipelines/capture/store.ts` | Buffer-first writes: write to `LocalCache.buffer()` instead of direct API call |
| `index.ts` | Initialize `LocalCache` + `SyncDaemon`, pass to pipeline context, replace stub file logic |
| `src/status-reporter.ts` | Add local cache stats (memory count, buffer depth, sync lag) |
| `openclaw.plugin.json` | Add `localCache` config schema section |
| `CLAUDE.md` | Update architecture docs, add cache module descriptions |

---

## 3. MemorySearchManager Interface

The plugin must expose a manager object compatible with OpenClaw's status scanner. Based on reverse-engineering `status.scan.json-core-Dq58GPqJ.js` and `pi-embedded-BaSvmUpW.js`:

### Required Methods

```typescript
class PluginMemoryManager {
  /**
   * Return current memory store status.
   * Called by: status.scan.json-core → resolveSharedMemoryStatusSnapshot()
   *
   * Must return shape compatible with MemoryProviderStatus.
   * The scanner destructures: { files, chunks, vector, fts, cache, ... }
   */
  status(): MemoryProviderStatus {
    const count = this.localCache.count();
    return {
      backend: "plugin",
      files: count,                              // memories count as "files"
      chunks: count,                             // 1:1 mapping for plugin memories
      dirty: this.syncDaemon.hasPendingBuffer(), // true if unflushed buffer entries
      workspaceDir: this.workspaceDir,
      dbPath: this.localCache.dbPath,
      provider: "memoryrelay",
      model: undefined,
      requestedProvider: "memoryrelay",
      sources: ["memory"],
      extraPaths: [],
      sourceCounts: [{ source: "memory", files: count, chunks: count }],
      cache: { enabled: true, entries: count },
      fts: {
        enabled: true,
        available: true,                         // FTS5 always available with better-sqlite3
      },
      vector: {
        enabled: this.vectorEnabled,
        available: this.vectorAvailable,          // set by probeVectorAvailability()
        extensionPath: this.vectorExtensionPath,
        dims: this.vectorDims,
      },
      batch: { enabled: false, failures: 0, limit: 0, wait: false, concurrency: 1, pollIntervalMs: 0, timeoutMs: 0 },
      custom: {
        searchMode: this.vectorAvailable ? "hybrid" : "fts-only",
        plugin: "plugin-memoryrelay-ai",
        syncLag: this.syncDaemon.lastSyncAgeMs(),
        bufferDepth: this.localCache.bufferDepth(),
      },
    };
  }

  /**
   * Probe whether vector similarity search is available.
   * Called by: status scanner before status()
   *
   * Attempts to load sqlite-vec extension. Returns true if loaded.
   * Graceful: returns false if extension not found (FTS5-only mode).
   */
  async probeVectorAvailability(): Promise<boolean> {
    if (!this.vectorEnabled) return false;
    try {
      this.localCache.loadVectorExtension();
      this.vectorAvailable = true;
      return true;
    } catch {
      this.vectorAvailable = false;
      return false;
    }
  }

  /**
   * Close the database connection and stop the sync daemon.
   * Called by: scanner cleanup, plugin shutdown.
   */
  async close(): Promise<void> {
    this.syncDaemon.stop();
    this.localCache.close();
  }
}
```

### Registration Point

In `index.ts`, the plugin must expose the manager so OpenClaw's scanner can find it. The scanner accesses it through the gateway's `getMemorySearchManager()` callback. Since we're a plugin (not memory-core), we register via `api.gateway.setMemoryManager(manager)` if the API exists, or ensure the SQLite file at the expected path is a valid database that the built-in scanner can open.

**Approach:** Create a real SQLite database at `~/.openclaw/memory/{agentId}.sqlite` (replacing the current empty stub file) that the scanner can open directly. The scanner's `MemoryIndexManager.get()` will instantiate its own manager against our database file. Our `status()` shape in the database tables must be compatible.

---

## 4. Phase Breakdown

### Phase 1: Local Store Foundation (v0.17.0-alpha)

**Goal:** `LocalCache` class with schema, CRUD, FTS5 search, and TTL eviction.

**Files to create:**
- `src/cache/types.ts`
- `src/cache/schema.ts`
- `src/cache/local-cache.ts`
- `tests/cache/schema.test.ts`
- `tests/cache/local-cache.test.ts`

**Key signatures:**

```typescript
// src/cache/types.ts
export interface LocalCacheConfig {
  enabled: boolean;
  dbPath: string;
  syncIntervalMinutes: number;
  maxLocalMemories: number;
  vectorSearch: { enabled: boolean; provider: string };
  ttl: { hot: number; warm: number; cold: number }; // hours
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
  bufferDepth: number;
  lastSync: string | null;
  dbSizeBytes: number;
}
```

```typescript
// src/cache/local-cache.ts
import Database from "better-sqlite3";

export class LocalCache {
  constructor(config: LocalCacheConfig);

  // Lifecycle
  open(): void;
  close(): void;
  get dbPath(): string;

  // CRUD
  upsert(memory: Memory): void;
  upsertBatch(memories: Memory[]): void;
  get(id: string): Memory | null;
  delete(id: string): boolean;
  count(): number;

  // Search
  searchFts(query: string, limit?: number): ScoredMemory[];
  searchByScope(scope: string, sessionId?: string, namespace?: string, limit?: number): Memory[];

  // Buffer (for capture pipeline)
  bufferWrite(entry: Omit<BufferEntry, "id" | "flushed">): number;
  bufferRead(limit?: number): BufferEntry[];
  bufferMarkFlushed(ids: number[]): void;
  bufferDepth(): number;

  // Sync state
  getSyncState(): SyncState;
  setSyncState(key: string, value: string): void;

  // TTL / eviction
  evictExpired(): number;
  enforceCap(maxMemories: number): number;

  // Vector (Phase 3)
  loadVectorExtension(): boolean;
  searchVector(embedding: Float32Array, limit?: number): ScoredMemory[];
}
```

**Test requirements:**
- Schema creation on fresh database
- CRUD: insert, upsert (update existing), get, delete
- FTS5: search returns ranked results, handles special characters
- Buffer: write, read, mark flushed, depth count
- TTL: evict expired memories by tier
- Cap enforcement: evicts oldest cold first
- Concurrent access: no SQLITE_BUSY on read during write

**Definition of done:**
- `LocalCache` passes all unit tests
- Database file created at configured path
- Schema version tracked in `cache_meta`
- FTS5 search returns results for exact and partial matches

---

### Phase 2: Sync Daemon + Pipeline Integration (v0.17.0-beta)

**Goal:** Background sync between local cache and API. Recall pipeline reads local-first. Capture pipeline writes to buffer.

**Files to create:**
- `src/cache/sync-daemon.ts`
- `tests/cache/sync-daemon.test.ts`
- `tests/integration/local-cache-pipeline.test.ts`

**Files to modify:**
- `src/pipelines/recall/search.ts`
- `src/pipelines/capture/store.ts`
- `src/pipelines/types.ts`
- `index.ts`
- `package.json`
- `openclaw.plugin.json`

**Key signatures:**

```typescript
// src/cache/sync-daemon.ts
export class SyncDaemon {
  constructor(
    localCache: LocalCache,
    client: MemoryRelayClient,
    config: { syncIntervalMinutes: number; agentId: string },
  );

  // Lifecycle
  start(): void;
  stop(): void;
  isRunning(): boolean;

  // Sync operations
  pull(): Promise<{ upserted: number; deleted: number }>;
  push(): Promise<{ flushed: number; failed: number }>;
  fullSync(): Promise<void>;

  // State
  hasPendingBuffer(): boolean;
  lastSyncAgeMs(): number;
  lastSyncAt(): string | null;

  // Backoff
  private currentBackoffMs: number;
  private resetBackoff(): void;
  private increaseBackoff(): void;
}
```

**Modified recall search (search.ts):**

```typescript
// New flow: local-first, API-fallback
execute: async (input, ctx) => {
  const { localCache } = ctx;

  // If local cache available, search locally
  if (localCache) {
    const localResults = localCache.searchFts(input.prompt, limit);
    const sessionResults = localCache.searchByScope("session", sessionId, namespace, limit);

    // Trigger background API refresh if stale
    if (localCache.isStale(syncIntervalMinutes)) {
      // Fire-and-forget: sync in background
      ctx.syncDaemon?.pull().catch(() => {});
    }

    return {
      action: "continue",
      data: {
        ...input,
        longTerm: localResults.map(r => ({ memory: r.memory, finalScore: r.finalScore })),
        session: sessionResults.map(m => ({ memory: m, finalScore: 1.0 })),
      },
    };
  }

  // Fallback: existing API-based search
  // ... existing code unchanged ...
};
```

**Modified capture store (store.ts):**

```typescript
// New flow: buffer-first, async flush
execute: async (input, ctx) => {
  const { localCache } = ctx;

  for (const msg of toStore) {
    const scope = resolveScope(msg.content);

    if (localCache) {
      // Write to local buffer — <1ms, non-blocking
      localCache.bufferWrite({
        content: msg.content,
        metadata: { source: "auto-capture", scope },
        scope,
        session_id: scope === "session" ? sessionId : undefined,
        namespace: ctx.requestCtx.namespace,
        created_at: new Date().toISOString(),
      });
    } else {
      // Fallback: direct API call (existing behavior)
      await ctx.client.store(msg.content, { source: "auto-capture", scope }, opts);
    }
  }
  return { action: "continue", data: input };
};
```

**Test requirements:**
- SyncDaemon pull: fetches from API, upserts locally
- SyncDaemon push: reads buffer, sends to API, marks flushed
- Conflict resolution: API wins for existing, local wins for new
- Backoff: increases on failure, resets on success
- Pipeline integration: recall reads from local cache
- Pipeline integration: capture writes to buffer
- Graceful degradation: falls back to API when cache disabled/corrupt

**Definition of done:**
- SyncDaemon runs on interval, pulls and pushes correctly
- Recall pipeline uses local cache when available
- Capture pipeline writes to buffer, not API
- All existing 243+ tests still pass
- New integration test verifies full local-first flow

---

### Phase 3: Vector Search (v0.17.0)

**Goal:** Optional `sqlite-vec` integration for cosine similarity search.

**Files to modify:**
- `src/cache/local-cache.ts` (add vector methods)
- `src/cache/memory-manager.ts` (probe vector availability)
- `src/pipelines/recall/search.ts` (use vector search when available)
- `package.json` (add optional `sqlite-vec` dependency)

**Key signatures:**

```typescript
// Additional LocalCache methods
export class LocalCache {
  // Vector extension
  loadVectorExtension(): boolean;
  isVectorReady(): boolean;

  // Vector search
  searchVector(embedding: Float32Array, limit?: number, minScore?: number): ScoredMemory[];

  // Hybrid search (FTS5 + vector, merged ranking)
  searchHybrid(
    query: string,
    embedding: Float32Array,
    opts?: { limit?: number; ftsWeight?: number; vectorWeight?: number },
  ): ScoredMemory[];

  // Store embedding with memory
  upsertWithEmbedding(memory: Memory, embedding: Float32Array): void;
}
```

**Test requirements:**
- Vector extension loads successfully (when available)
- Graceful degradation when sqlite-vec not installed
- Vector search returns cosine-similar results
- Hybrid search merges FTS5 + vector scores

**Definition of done:**
- `sqlite-vec` loads as optional dependency
- Vector search works when extension available
- Falls back to FTS5-only gracefully
- `probeVectorAvailability()` returns correct boolean

---

### Phase 4: Observability + Status Integration (v0.17.0)

**Goal:** `/memory-status` command, `memory.probe` enrichment, `openclaw status` shows real counts.

**Files to create:**
- `src/cache/memory-manager.ts`
- `tests/cache/memory-manager.test.ts`

**Files to modify:**
- `index.ts` (register memory manager, replace stub logic)
- `src/status-reporter.ts` (add cache stats)
- `CLAUDE.md` (update docs)

**Key signatures:**

```typescript
// src/cache/memory-manager.ts
export class PluginMemoryManager {
  constructor(
    localCache: LocalCache,
    syncDaemon: SyncDaemon,
    config: { workspaceDir: string; vectorEnabled: boolean },
  );

  status(): MemoryProviderStatus;
  probeVectorAvailability(): Promise<boolean>;
  close(): Promise<void>;
}
```

**Status command enhancements (`/memory-status`):**

```
MemoryRelay Status
──────────────────
Local cache:   331 memories (12.4 MB)
Buffer depth:  3 pending writes
Last sync:     2 minutes ago
Sync status:   healthy
Vector search: ready (sqlite-vec 0.1.6, 384 dims)
FTS5:          ready
API:           connected (api.memoryrelay.net)
```

**`openclaw status` output target:**

```
Memory    331 files · 331 chunks · plugin plugin-memoryrelay-ai · vector ready
```

**Test requirements:**
- `PluginMemoryManager.status()` returns correct shape
- `probeVectorAvailability()` returns boolean
- `close()` stops daemon and closes DB
- `/memory-status` command outputs correct stats
- `openclaw status` shows memory count (integration)

**Definition of done:**
- `openclaw status` shows real memory count (not `unavailable`)
- `/memory-status` shows local cache stats, sync lag, buffer depth
- All 243+ existing tests pass
- New tests for memory manager wrapper

---

## 5. Risk Analysis

### 5.1 `better-sqlite3` Native Bindings

**Risk:** Installation fails on some platforms (Alpine, ARM, Windows with missing build tools).

**Mitigation:**
- `better-sqlite3` ships prebuilt binaries for all major platforms
- Add graceful degradation: if `better-sqlite3` fails to load, fall back to API-only mode (v0.16.x behavior)
- Log clear error message with install instructions

```typescript
let Database: typeof import("better-sqlite3").default;
try {
  Database = (await import("better-sqlite3")).default;
} catch (err) {
  logger.warn(`Local cache unavailable: ${err}. Falling back to API-only mode.`);
  return; // Skip cache initialization
}
```

### 5.2 Local Store Corruption

**Risk:** SQLite file gets corrupted (disk full, process kill during write, concurrent access).

**Mitigation:**
- Enable WAL mode (`PRAGMA journal_mode=WAL`) — crash-safe, concurrent reads during writes
- Run `PRAGMA integrity_check` on open — if corrupt, delete and recreate from API
- API is always the source of truth; local store is a cache
- Add recovery flow:

```typescript
try {
  db = new Database(dbPath);
  const check = db.pragma("integrity_check");
  if (check[0]?.integrity_check !== "ok") throw new Error("integrity check failed");
} catch {
  logger.warn("Local cache corrupt, rebuilding from API...");
  fs.unlinkSync(dbPath);
  db = new Database(dbPath);
  initSchema(db);
  await syncDaemon.fullSync(); // Rebuild from API
}
```

### 5.3 Sync Daemon on Gateway Restart

**Risk:** Daemon's `setInterval` orphaned on restart, causing duplicate sync or missing data.

**Mitigation:**
- `SyncDaemon.stop()` called in plugin cleanup hook (`api.onShutdown`)
- `clearInterval` in `stop()` — no orphaned timers
- Sync state persisted in SQLite (`sync_state` table) — daemon resumes from last cursor
- Idempotent operations: `upsert` (not insert), `bufferMarkFlushed` by ID

### 5.4 Schema Migration Strategy

**Risk:** Future v0.18.0 needs schema changes; existing databases must migrate.

**Mitigation:**
- Schema version stored in `cache_meta` table (`schema_version = "1"`)
- Migration runner checks version on open:

```typescript
const CURRENT_SCHEMA_VERSION = 1;

function migrateIfNeeded(db: Database.Database): void {
  const row = db.prepare("SELECT value FROM cache_meta WHERE key = 'schema_version'").get();
  const version = row ? parseInt(row.value, 10) : 0;

  if (version < 1) {
    // Initial schema — run full CREATE
    createSchema(db);
    db.prepare("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schema_version', ?)").run(String(CURRENT_SCHEMA_VERSION));
  }
  // Future: if (version < 2) { runMigrationV2(db); }
}
```

### 5.5 Disk Space

**Risk:** SQLite file grows unbounded on VPS with limited disk.

**Mitigation:**
- `maxLocalMemories` config cap (default: 1000)
- TTL eviction on every sync cycle
- `VACUUM` after large deletions (>100 rows evicted)
- Warn in status when DB > 50MB

---

## 6. Sub-issues to Create

### Epic: #62 (Local SQLite Cache Layer)

| # | Title | Description | Complexity | Dependencies |
|---|-------|-------------|------------|--------------|
| 1 | **Add `better-sqlite3` dependency and schema module** | Add `better-sqlite3` + `@types/better-sqlite3` to `package.json`. Create `src/cache/schema.ts` with SQL constants, `createSchema()`, `migrateIfNeeded()`. Create `src/cache/types.ts` with `LocalCacheConfig`, `BufferEntry`, `SyncState`, `CacheStats` types. Tests for schema creation and version tracking. | **M** | None |
| 2 | **Implement `LocalCache` class** | Create `src/cache/local-cache.ts` with full CRUD, FTS5 search, buffer operations, TTL eviction, cap enforcement. WAL mode, integrity checks. Comprehensive unit tests. | **L** | #1 |
| 3 | **Implement `SyncDaemon` class** | Create `src/cache/sync-daemon.ts` with background pull/push, exponential backoff, conflict resolution (API wins for edits, local wins for new). Unit tests with mocked API client. | **L** | #1, #2 |
| 4 | **Integrate local cache with recall pipeline** | Modify `src/pipelines/recall/search.ts` for local-first search with API fallback. Add `localCache` to `PipelineContext`. Background refresh trigger when stale. Integration tests. | **M** | #2 |
| 5 | **Integrate local cache with capture pipeline** | Modify `src/pipelines/capture/store.ts` for buffer-first writes. SyncDaemon flushes buffer to API. Integration tests. | **M** | #2, #3 |
| 6 | **Wire up in `index.ts` + config schema** | Initialize `LocalCache` + `SyncDaemon` in plugin entry. Add `localCache` config to `openclaw.plugin.json`. Replace stub file logic with real database. Handle graceful degradation. | **M** | #2, #3, #4, #5 |
| 7 | **Optional `sqlite-vec` vector search** | Add optional `sqlite-vec` dependency. Implement `loadVectorExtension()`, `searchVector()`, `searchHybrid()`. Graceful degradation to FTS5-only. | **L** | #2 |
| 8 | **`PluginMemoryManager` for `openclaw status` integration** | Create `src/cache/memory-manager.ts` implementing `status()`, `probeVectorAvailability()`, `close()`. Verify `openclaw status` shows real memory count. | **M** | #2, #3, #7 |
| 9 | **Observability: `/memory-status` + `memory.probe` enrichment** | Enhance `/memory-status` command with local cache stats. Enrich `memory.probe` gateway method. Expose sync health metrics. | **S** | #6, #8 |
| 10 | **Update CLAUDE.md and documentation** | Update architecture docs, add cache module descriptions, update test count, document new config options. | **S** | #6 |

### Suggested Sprint Plan

```
Sprint 1 (Week 1):  #1, #2         — Foundation
Sprint 2 (Week 2):  #3, #4, #5     — Sync + Pipeline integration
Sprint 3 (Week 3):  #6, #7         — Wiring + Vector search
Sprint 4 (Week 4):  #8, #9, #10    — Status + Observability + Docs
```

---

## 7. Test Strategy

### Current Baseline
- 243 tests across 22 files (all must continue to pass)

### New Tests by Module

#### `tests/cache/schema.test.ts` (~10 tests)
- Creates all tables on fresh database
- FTS5 virtual table and triggers created
- `cache_meta` stores schema version
- `migrateIfNeeded()` is idempotent (running twice is safe)
- Schema version check returns correct version
- Migration from v0 to v1 succeeds

#### `tests/cache/local-cache.test.ts` (~35 tests)
- **CRUD:** insert, upsert (update), get by ID, delete, count
- **FTS5 search:** exact match, partial match, multi-word, special characters, empty query
- **Scope search:** by scope, by session_id, by namespace, combined filters
- **Buffer:** write entry, read pending, mark flushed, depth count, read after flush returns empty
- **TTL eviction:** hot expires after 72h, warm after 7d, cold after 30d, non-expired preserved
- **Cap enforcement:** evicts cold first, then warm, preserves hot
- **Sync state:** get/set sync state values
- **Edge cases:** empty database search, very long content, Unicode content, concurrent reads
- **WAL mode:** verify `PRAGMA journal_mode` returns `wal`
- **Integrity:** corrupt DB triggers rebuild

#### `tests/cache/sync-daemon.test.ts` (~25 tests)
- **Pull:** fetches memories from API, upserts locally
- **Pull:** handles empty API response
- **Pull:** uses cursor for incremental sync
- **Pull:** API error triggers backoff
- **Push:** reads buffer entries, sends to API
- **Push:** marks entries flushed after successful API call
- **Push:** API error leaves entries unflushed
- **Push:** handles empty buffer (no-op)
- **Conflict resolution:** API version overwrites local for same remote_id
- **Conflict resolution:** new local memory pushed to API
- **Backoff:** increases 1min → 5min → 30min on consecutive failures
- **Backoff:** resets to base after success
- **Lifecycle:** start creates interval, stop clears it
- **Lifecycle:** stop is idempotent

#### `tests/cache/memory-manager.test.ts` (~15 tests)
- **status():** returns correct `MemoryProviderStatus` shape
- **status():** `files` and `chunks` match local memory count
- **status():** `fts.available` is true
- **status():** `vector.available` reflects probe result
- **status():** `custom.bufferDepth` matches pending buffer entries
- **probeVectorAvailability():** returns true when extension loads
- **probeVectorAvailability():** returns false when extension missing
- **close():** stops sync daemon
- **close():** closes database connection

#### `tests/integration/local-cache-pipeline.test.ts` (~15 tests)
- **Recall:** local-first search returns cached memories
- **Recall:** falls back to API when cache empty
- **Recall:** triggers background sync when stale
- **Capture:** writes to buffer instead of API
- **Capture:** buffer entries flushed by SyncDaemon
- **End-to-end:** capture → buffer → sync → recall from local
- **Graceful degradation:** cache disabled falls back to API-only
- **Graceful degradation:** cache corrupt triggers rebuild

### Test Total Estimate
- Existing: 243 tests
- New: ~100 tests
- **Target: ~343 tests across ~27 files**

### Test Infrastructure
- All cache tests use in-memory SQLite (`:memory:`) or temp files (`os.tmpdir()`)
- API client mocked (no real API calls, consistent with existing test patterns)
- `SyncDaemon` tests mock `setInterval`/`clearInterval` for deterministic timing
- Cleanup: delete temp SQLite files in `afterEach`

---

## Appendix: Configuration Schema Addition

```json
{
  "localCache": {
    "type": "object",
    "description": "Local SQLite cache for fast, offline-capable memory access",
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true,
        "description": "Enable local SQLite cache layer"
      },
      "syncIntervalMinutes": {
        "type": "number",
        "default": 5,
        "minimum": 1,
        "maximum": 60,
        "description": "How often to sync with the API (minutes)"
      },
      "maxLocalMemories": {
        "type": "number",
        "default": 1000,
        "minimum": 100,
        "maximum": 10000,
        "description": "Maximum number of memories to keep locally"
      },
      "vectorSearch": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean", "default": true },
          "provider": { "type": "string", "default": "sqlite-vec" }
        }
      },
      "ttl": {
        "type": "object",
        "description": "Time-to-live per tier (hours)",
        "properties": {
          "hot": { "type": "number", "default": 72 },
          "warm": { "type": "number", "default": 168 },
          "cold": { "type": "number", "default": 720 }
        }
      }
    }
  }
}
```
