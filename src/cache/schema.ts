import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 1;

export const CREATE_MEMORIES_TABLE = `CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  remote_id     TEXT UNIQUE,
  content       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  user_id       TEXT DEFAULT '',
  metadata      TEXT DEFAULT '{}',
  entities      TEXT DEFAULT '[]',
  importance    REAL DEFAULT 0.5,
  tier          TEXT DEFAULT 'warm'
                  CHECK(tier IN ('hot', 'warm', 'cold')),
  scope         TEXT DEFAULT 'long-term'
                  CHECK(scope IN ('session', 'long-term')),
  session_id    TEXT,
  namespace     TEXT DEFAULT 'default',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  synced_at     TEXT,
  expires_at    TEXT,
  embedding     BLOB
)`;

export const CREATE_MEMORIES_FTS = `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  metadata,
  content=memories,
  content_rowid=rowid
)`;

export const CREATE_FTS_TRIGGER_INSERT = `CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories
  BEGIN INSERT INTO memories_fts(rowid, content, metadata) VALUES (new.rowid, new.content, new.metadata); END`;

export const CREATE_FTS_TRIGGER_DELETE = `CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories
  BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, metadata) VALUES ('delete', old.rowid, old.content, old.metadata); END`;

export const CREATE_FTS_TRIGGER_UPDATE = `CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories
  BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, metadata) VALUES ('delete', old.rowid, old.content, old.metadata);
        INSERT INTO memories_fts(rowid, content, metadata) VALUES (new.rowid, new.content, new.metadata); END`;

export const CREATE_BUFFER_TABLE = `CREATE TABLE IF NOT EXISTS session_buffer (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content     TEXT NOT NULL,
  metadata    TEXT DEFAULT '{}',
  scope       TEXT DEFAULT 'long-term',
  session_id  TEXT,
  namespace   TEXT DEFAULT 'default',
  created_at  TEXT NOT NULL,
  flushed     INTEGER DEFAULT 0
)`;

export const CREATE_SYNC_STATE_TABLE = `CREATE TABLE IF NOT EXISTS sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
)`;

export const CREATE_CACHE_META_TABLE = `CREATE TABLE IF NOT EXISTS cache_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
)`;

export const CREATE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_memories_agent     ON memories(agent_id)",
  "CREATE INDEX IF NOT EXISTS idx_memories_tier      ON memories(tier)",
  "CREATE INDEX IF NOT EXISTS idx_memories_scope     ON memories(scope)",
  "CREATE INDEX IF NOT EXISTS idx_memories_session   ON memories(session_id)",
  "CREATE INDEX IF NOT EXISTS idx_memories_namespace  ON memories(namespace)",
  "CREATE INDEX IF NOT EXISTS idx_memories_expires   ON memories(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_memories_synced    ON memories(synced_at)",
  "CREATE INDEX IF NOT EXISTS idx_memories_updated   ON memories(updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_buffer_flushed     ON session_buffer(flushed, created_at)",
];

/**
 * Run a SQL statement on the database.
 * Wrapper around Database.exec to keep schema module self-contained.
 */
function run(db: Database.Database, sql: string): void {
  db.prepare(sql).run();
}

function runDDL(db: Database.Database, sql: string): void {
  // For DDL statements (CREATE TABLE, CREATE INDEX, CREATE TRIGGER, CREATE VIRTUAL TABLE)
  // we need to use the exec method on the database instance
  const fn = (db as unknown as { exec: (sql: string) => void }).exec.bind(db);
  fn(sql);
}

export function createSchema(db: Database.Database): void {
  runDDL(db, CREATE_MEMORIES_TABLE);
  runDDL(db, CREATE_MEMORIES_FTS);
  runDDL(db, CREATE_FTS_TRIGGER_INSERT);
  runDDL(db, CREATE_FTS_TRIGGER_DELETE);
  runDDL(db, CREATE_FTS_TRIGGER_UPDATE);
  runDDL(db, CREATE_BUFFER_TABLE);
  runDDL(db, CREATE_SYNC_STATE_TABLE);
  runDDL(db, CREATE_CACHE_META_TABLE);
  for (const idx of CREATE_INDEXES) {
    runDDL(db, idx);
  }
  db.prepare("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schema_version', ?)").run(
    String(SCHEMA_VERSION),
  );
}

/**
 * Create the vec0 virtual table for vector search.
 * Only call after sqlite-vec extension has been loaded.
 * Separated from createSchema() because it depends on an optional extension.
 */
export function createVecSchema(db: Database.Database): void {
  runDDL(
    db,
    "CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding float[768])",
  );
}

export function getSchemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM cache_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

export function migrateIfNeeded(db: Database.Database): void {
  // Ensure cache_meta exists so we can read the version
  runDDL(db, CREATE_CACHE_META_TABLE);
  const version = getSchemaVersion(db);

  if (version < 1) {
    createSchema(db);
  }
  // Future: if (version < 2) { runMigrationV2(db); }
}
