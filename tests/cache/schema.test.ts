import { describe, test, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  SCHEMA_VERSION,
  createSchema,
  migrateIfNeeded,
  getSchemaVersion,
  CREATE_MEMORIES_TABLE,
  CREATE_MEMORIES_FTS,
  CREATE_BUFFER_TABLE,
  CREATE_SYNC_STATE_TABLE,
  CREATE_CACHE_META_TABLE,
} from "../../src/cache/schema";

describe("cache/schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("createSchema()", () => {
    test("creates all tables on fresh database", () => {
      createSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("memories");
      expect(tableNames).toContain("session_buffer");
      expect(tableNames).toContain("sync_state");
      expect(tableNames).toContain("cache_meta");
    });

    test("creates FTS5 virtual table", () => {
      createSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
        .all();
      expect(tables).toHaveLength(1);
    });

    test("creates FTS triggers", () => {
      createSchema(db);

      const triggers = db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
        .all() as { name: string }[];
      const triggerNames = triggers.map((t) => t.name);

      expect(triggerNames).toContain("memories_ai");
      expect(triggerNames).toContain("memories_ad");
      expect(triggerNames).toContain("memories_au");
    });

    test("creates all indexes", () => {
      createSchema(db);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain("idx_memories_agent");
      expect(indexNames).toContain("idx_memories_tier");
      expect(indexNames).toContain("idx_memories_scope");
      expect(indexNames).toContain("idx_memories_session");
      expect(indexNames).toContain("idx_memories_namespace");
      expect(indexNames).toContain("idx_memories_expires");
      expect(indexNames).toContain("idx_memories_synced");
      expect(indexNames).toContain("idx_memories_updated");
      expect(indexNames).toContain("idx_buffer_flushed");
    });

    test("stores schema version in cache_meta", () => {
      createSchema(db);

      const row = db
        .prepare("SELECT value FROM cache_meta WHERE key = 'schema_version'")
        .get() as { value: string };

      expect(row).toBeDefined();
      expect(parseInt(row.value, 10)).toBe(SCHEMA_VERSION);
    });

    test("is idempotent — running twice does not error", () => {
      createSchema(db);
      expect(() => createSchema(db)).not.toThrow();

      // Version should still be correct
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    });
  });

  describe("getSchemaVersion()", () => {
    test("returns 0 on empty database with only cache_meta table", () => {
      db.prepare("CREATE TABLE cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
      expect(getSchemaVersion(db)).toBe(0);
    });

    test("returns correct version after createSchema()", () => {
      createSchema(db);
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    });
  });

  describe("migrateIfNeeded()", () => {
    test("creates schema on fresh database", () => {
      migrateIfNeeded(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("memories");
      expect(tableNames).toContain("session_buffer");
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    });

    test("is idempotent — running multiple times is safe", () => {
      migrateIfNeeded(db);
      migrateIfNeeded(db);
      migrateIfNeeded(db);

      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

      // Verify tables still intact
      const count = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as { c: number };
      expect(count.c).toBeGreaterThan(0);
    });

    test("skips creation when schema is already current", () => {
      createSchema(db);

      // Insert a test row to verify data is preserved
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO memories (id, content, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("test-1", "hello", "agent-1", now, now);

      migrateIfNeeded(db);

      // Data should still be there
      const row = db.prepare("SELECT content FROM memories WHERE id = 'test-1'").get() as { content: string };
      expect(row.content).toBe("hello");
    });
  });

  describe("FTS5 integration", () => {
    test("FTS index is populated via trigger on INSERT", () => {
      createSchema(db);

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO memories (id, content, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("m1", "the quick brown fox", "agent-1", now, now);

      const results = db
        .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH 'quick'")
        .all();
      expect(results).toHaveLength(1);
    });

    test("FTS index is updated via trigger on UPDATE", () => {
      createSchema(db);

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO memories (id, content, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("m1", "original content", "agent-1", now, now);

      db.prepare("UPDATE memories SET content = ? WHERE id = ?").run("updated content", "m1");

      const oldResults = db
        .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH 'original'")
        .all();
      expect(oldResults).toHaveLength(0);

      const newResults = db
        .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH 'updated'")
        .all();
      expect(newResults).toHaveLength(1);
    });

    test("FTS index is cleaned via trigger on DELETE", () => {
      createSchema(db);

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO memories (id, content, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("m1", "deletable content", "agent-1", now, now);

      db.prepare("DELETE FROM memories WHERE id = ?").run("m1");

      const results = db
        .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH 'deletable'")
        .all();
      expect(results).toHaveLength(0);
    });
  });

  describe("table constraints", () => {
    test("memories tier CHECK constraint rejects invalid values", () => {
      createSchema(db);

      const now = new Date().toISOString();
      expect(() =>
        db.prepare(
          "INSERT INTO memories (id, content, agent_id, tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run("m1", "content", "agent-1", "invalid", now, now),
      ).toThrow();
    });

    test("memories scope CHECK constraint rejects invalid values", () => {
      createSchema(db);

      const now = new Date().toISOString();
      expect(() =>
        db.prepare(
          "INSERT INTO memories (id, content, agent_id, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run("m1", "content", "agent-1", "invalid", now, now),
      ).toThrow();
    });
  });
});
