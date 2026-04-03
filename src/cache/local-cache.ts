import type BetterSqlite3 from "better-sqlite3";
import { statSync } from "node:fs";
import { migrateIfNeeded } from "./schema.js";
import type {
  LocalCacheConfig,
  LocalMemory,
  BufferEntry,
  SyncState,
  CacheStats,
} from "./types.js";

interface MemoryRow {
  id: string;
  remote_id: string | null;
  content: string;
  agent_id: string;
  user_id: string;
  metadata: string;
  entities: string;
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

interface BufferRow {
  id: number;
  content: string;
  metadata: string;
  scope: "session" | "long-term";
  session_id: string | null;
  namespace: string;
  created_at: string;
  flushed: number;
}

interface FtsRow extends MemoryRow {
  rank: number;
}

function rowToMemory(row: MemoryRow): LocalMemory {
  return {
    ...row,
    metadata: JSON.parse(row.metadata),
    entities: JSON.parse(row.entities),
  };
}

function rowToBuffer(row: BufferRow): BufferEntry {
  return {
    ...row,
    metadata: JSON.parse(row.metadata),
    scope: row.scope as "session" | "long-term",
    flushed: row.flushed === 1,
  };
}

export class LocalCache {
  private db: BetterSqlite3.Database | null;
  private readonly _dbPath: string;
  private readonly config: LocalCacheConfig;

  constructor(dbPath: string, config: LocalCacheConfig) {
    this._dbPath = dbPath;
    this.config = config;
    this.db = null;

    let Database: typeof BetterSqlite3 | undefined;
    // Suppress bindings warning to stderr by redirecting it temporarily
    // The 'bindings' package prints "Could not locate the bindings file" before throwing
    const origStderr = process.stderr.write;
    process.stderr.write = () => true; // discard
    try {
      Database = require("better-sqlite3");
    } catch {
      // silently fall through - db remains null (API-only mode)
    } finally {
      process.stderr.write = origStderr;
    }

    if (!Database) {
      // better-sqlite3 native binary not available — API-only mode
      return;
    }

    try {
      this.db = this.initDb(dbPath, Database);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log to stderr so callers can surface it; db remains null (API-only mode)
      process.stderr.write(
        `[memoryrelay] Local cache unavailable — SQLite initialization failed. ` +
        `Plugin will use API-only mode (no offline caching). ` +
        `To fix: run \`npm rebuild better-sqlite3\` in the plugin directory. ` +
        `Error: ${msg}\n`,
      );
    }
  }

  /** Returns true when the local SQLite cache is available. */
  get isAvailable(): boolean {
    return this.db !== null;
  }

  get dbPath(): string {
    return this._dbPath;
  }

  private initDb(dbPath: string, Database: typeof BetterSqlite3): BetterSqlite3.Database {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    migrateIfNeeded(db);
    return db;
  }

  // --- Memory CRUD ---

  upsert(memory: Partial<LocalMemory> & { id: string; content: string; agent_id: string }): void {
    if (!this.db) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, remote_id, content, agent_id, user_id, metadata, entities,
        importance, tier, scope, session_id, namespace, created_at, updated_at, synced_at, expires_at, embedding)
      VALUES (@id, @remote_id, @content, @agent_id, @user_id, @metadata, @entities,
        @importance, @tier, @scope, @session_id, @namespace, @created_at, @updated_at, @synced_at, @expires_at, @embedding)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        remote_id = COALESCE(excluded.remote_id, memories.remote_id),
        agent_id = excluded.agent_id,
        user_id = excluded.user_id,
        metadata = excluded.metadata,
        entities = excluded.entities,
        importance = excluded.importance,
        tier = excluded.tier,
        scope = excluded.scope,
        session_id = excluded.session_id,
        namespace = excluded.namespace,
        updated_at = excluded.updated_at,
        synced_at = excluded.synced_at,
        expires_at = excluded.expires_at,
        embedding = excluded.embedding
    `);

    stmt.run({
      id: memory.id,
      remote_id: memory.remote_id ?? null,
      content: memory.content,
      agent_id: memory.agent_id,
      user_id: memory.user_id ?? "",
      metadata: JSON.stringify(memory.metadata ?? {}),
      entities: JSON.stringify(memory.entities ?? []),
      importance: memory.importance ?? 0.5,
      tier: memory.tier ?? "warm",
      scope: memory.scope ?? "long-term",
      session_id: memory.session_id ?? null,
      namespace: memory.namespace ?? "default",
      created_at: memory.created_at ?? now,
      updated_at: memory.updated_at ?? now,
      synced_at: memory.synced_at ?? null,
      expires_at: memory.expires_at ?? null,
      embedding: memory.embedding ?? null,
    });
  }

  get(id: string): LocalMemory | null {
    if (!this.db) return null;
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  delete(id: string): boolean {
    if (!this.db) return false;
    const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    return result.changes > 0;
  }

  count(): number {
    if (!this.db) return 0;
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM memories").get() as { cnt: number };
    return row.cnt;
  }

  countByTier(): { hot: number; warm: number; cold: number } {
    if (!this.db) return { hot: 0, warm: 0, cold: 0 };
    const rows = this.db
      .prepare("SELECT tier, COUNT(*) as cnt FROM memories GROUP BY tier")
      .all() as { tier: string; cnt: number }[];
    const result = { hot: 0, warm: 0, cold: 0 };
    for (const row of rows) {
      if (row.tier === "hot" || row.tier === "warm" || row.tier === "cold") {
        result[row.tier] = row.cnt;
      }
    }
    return result;
  }

  // --- Search ---

  search(
    query: string,
    opts?: { limit?: number; scope?: string; sessionId?: string; namespace?: string },
  ): LocalMemory[] {
    if (!this.db) return [];
    if (!query.trim()) return [];

    const limit = opts?.limit ?? 20;
    // Escape FTS5 special chars and wrap terms in double quotes for safe matching
    const safeQuery = query
      .replace(/['"]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"`)
      .join(" ");

    if (!safeQuery) return [];

    let sql = `
      SELECT m.*, fts.rank
      FROM memories_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
    `;
    const params: (string | number)[] = [safeQuery];

    if (opts?.scope) {
      sql += " AND m.scope = ?";
      params.push(opts.scope);
    }
    if (opts?.sessionId) {
      sql += " AND m.session_id = ?";
      params.push(opts.sessionId);
    }
    if (opts?.namespace) {
      sql += " AND m.namespace = ?";
      params.push(opts.namespace);
    }

    sql += " ORDER BY fts.rank LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as FtsRow[];
    return rows.map(rowToMemory);
  }

  searchByScope(
    scope: "session" | "long-term",
    sessionId?: string,
    opts?: { namespace?: string; limit?: number },
  ): LocalMemory[] {
    if (!this.db) return [];
    let sql = "SELECT * FROM memories WHERE scope = ?";
    const params: (string | number)[] = [scope];

    if (sessionId) {
      sql += " AND session_id = ?";
      params.push(sessionId);
    }
    if (opts?.namespace) {
      sql += " AND namespace = ?";
      params.push(opts.namespace);
    }

    sql += " ORDER BY updated_at DESC LIMIT ?";
    params.push(opts?.limit ?? 50);

    const rows = this.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  // --- Buffer (capture pipeline) ---

  bufferWrite(content: string, metadata: Record<string, unknown>): string {
    if (!this.db) return "";
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO session_buffer (content, metadata, scope, session_id, namespace, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const scope = (metadata.scope as string) ?? "long-term";
    const sessionId = (metadata.session_id as string) ?? null;
    const namespace = (metadata.namespace as string) ?? "default";

    const result = stmt.run(
      content,
      JSON.stringify(metadata),
      scope,
      sessionId,
      namespace,
      now,
    );
    return String(result.lastInsertRowid);
  }

  bufferReadPending(): BufferEntry[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT * FROM session_buffer WHERE flushed = 0 ORDER BY created_at ASC")
      .all() as BufferRow[];
    return rows.map(rowToBuffer);
  }

  bufferMarkFlushed(ids: string[]): void {
    if (!this.db) return;
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(`UPDATE session_buffer SET flushed = 1 WHERE id IN (${placeholders})`)
      .run(...ids.map(Number));
  }

  bufferDepth(): number {
    if (!this.db) return 0;
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM session_buffer WHERE flushed = 0")
      .get() as { cnt: number };
    return row.cnt;
  }

  // --- Sync state ---

  getSyncState(): SyncState {
    if (!this.db) return { lastPull: null, lastPush: null, cursor: null };
    const rows = this.db.prepare("SELECT key, value FROM sync_state").all() as {
      key: string;
      value: string;
    }[];
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      lastPull: map.get("last_pull") ?? null,
      lastPush: map.get("last_push") ?? null,
      cursor: map.get("cursor") ?? null,
    };
  }

  setSyncState(state: Partial<SyncState>): void {
    if (!this.db) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)",
    );
    const run = this.db.transaction(() => {
      if (state.lastPull !== undefined) stmt.run("last_pull", state.lastPull ?? "", now);
      if (state.lastPush !== undefined) stmt.run("last_push", state.lastPush ?? "", now);
      if (state.cursor !== undefined) stmt.run("cursor", state.cursor ?? "", now);
    });
    run();
  }

  // --- Maintenance ---

  evictExpired(): number {
    if (!this.db) return 0;
    const now = new Date().toISOString();
    const result = this.db
      .prepare("DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?")
      .run(now);
    return result.changes;
  }

  enforceCapLimit(): number {
    if (!this.db) return 0;
    const max = this.config.maxLocalMemories;
    const total = this.count();
    if (total <= max) return 0;

    const excess = total - max;
    const result = this.db
      .prepare(
        `DELETE FROM memories WHERE id IN (
          SELECT id FROM memories
          ORDER BY
            CASE tier WHEN 'cold' THEN 0 WHEN 'warm' THEN 1 WHEN 'hot' THEN 2 END,
            updated_at ASC
          LIMIT ?
        )`,
      )
      .run(excess);
    return result.changes;
  }

  stats(): CacheStats {
    const totalMemories = this.count();
    const tierBreakdown = this.countByTier();
    const bufferDepth = this.bufferDepth();
    const syncState = this.getSyncState();
    let dbSizeBytes = 0;
    if (this._dbPath !== ":memory:") {
      try {
        dbSizeBytes = statSync(this._dbPath).size;
      } catch {
        // file may not exist yet
      }
    }
    return {
      totalMemories,
      tierBreakdown,
      bufferDepth,
      lastSync: syncState.lastPull ?? syncState.lastPush ?? null,
      dbSizeBytes,
    };
  }

  close(): void {
    this.db?.close();
  }
}
