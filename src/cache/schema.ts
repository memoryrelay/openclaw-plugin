import type Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
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
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  metadata,
  content=memories,
  content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories
  BEGIN INSERT INTO memories_fts(rowid, content, metadata) VALUES (new.rowid, new.content, new.metadata); END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories
  BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, metadata) VALUES ('delete', old.rowid, old.content, old.metadata); END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories
  BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, metadata) VALUES ('delete', old.rowid, old.content, old.metadata);
        INSERT INTO memories_fts(rowid, content, metadata) VALUES (new.rowid, new.content, new.metadata); END;

CREATE TABLE IF NOT EXISTS session_buffer (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content     TEXT NOT NULL,
  metadata    TEXT DEFAULT '{}',
  scope       TEXT DEFAULT 'long-term',
  session_id  TEXT,
  namespace   TEXT DEFAULT 'default',
  created_at  TEXT NOT NULL,
  flushed     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_agent     ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_tier      ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_scope     ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_session   ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_namespace  ON memories(namespace);
CREATE INDEX IF NOT EXISTS idx_memories_expires   ON memories(expires_at);
CREATE INDEX IF NOT EXISTS idx_memories_synced    ON memories(synced_at);
CREATE INDEX IF NOT EXISTS idx_memories_updated   ON memories(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_buffer_flushed     ON session_buffer(flushed, created_at);
`;

export function createSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}

export function migrateIfNeeded(db: Database.Database): void {
  // Ensure cache_meta exists first (needed for version check)
  db.exec(`CREATE TABLE IF NOT EXISTS cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  const row = db
    .prepare("SELECT value FROM cache_meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  const version = row ? parseInt(row.value, 10) : 0;

  if (version < 1) {
    createSchema(db);
    db.prepare(
      "INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schema_version', ?)",
    ).run(String(CURRENT_SCHEMA_VERSION));
  }
  // Future: if (version < 2) { runMigrationV2(db); }
}

export function getSchemaVersion(db: Database.Database): number {
  try {
    const row = db
      .prepare("SELECT value FROM cache_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}
