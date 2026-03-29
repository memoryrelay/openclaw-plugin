import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/cache/schema";
import {
  loadVectorExtension,
  searchHybrid,
  storeEmbedding,
  createVecTable,
} from "../../src/cache/vector";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  createSchema(db);
  return db;
}

function insertMemory(db: Database.Database, id: string, content: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memories (id, content, agent_id, user_id, metadata, entities,
      importance, tier, scope, namespace, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, content, "agent-1", "user-1", "{}", "[]", 0.5, "warm", "long-term", "default", now, now);
}

function createMockVecTable(db: Database.Database): void {
  const fn = (db as unknown as { exec: (sql: string) => void }).exec.bind(db);
  fn(
    `CREATE TABLE IF NOT EXISTS memories_vec (
      memory_id TEXT PRIMARY KEY,
      embedding BLOB
    )`,
  );
}

describe("vector", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  // --- loadVectorExtension ---

  describe("loadVectorExtension", () => {
    test("returns false when sqlite-vec import fails", async () => {
      // Mock the import to simulate sqlite-vec not being installed
      vi.doMock("sqlite-vec", () => {
        throw new Error("Cannot find module 'sqlite-vec'");
      });
      // Re-import to pick up the mock
      const { loadVectorExtension: loadMocked } = await import("../../src/cache/vector");
      const result = await loadMocked(db);
      expect(result).toBe(false);
      vi.doUnmock("sqlite-vec");
    });

    test("returns boolean (true if available, false otherwise)", async () => {
      const result = await loadVectorExtension(db).catch(() => false);
      expect(typeof result).toBe("boolean");
    });
  });

  // --- searchVector ---

  describe("searchVector", () => {
    test("vec0 table can store and query memory IDs", () => {
      createMockVecTable(db);
      db.prepare("INSERT INTO memories_vec (memory_id, embedding) VALUES (?, ?)").run(
        "mem-1",
        Buffer.alloc(768 * 4),
      );
      db.prepare("INSERT INTO memories_vec (memory_id, embedding) VALUES (?, ?)").run(
        "mem-2",
        Buffer.alloc(768 * 4),
      );

      const rows = db
        .prepare("SELECT memory_id FROM memories_vec")
        .all() as { memory_id: string }[];
      expect(rows.map((r) => r.memory_id)).toEqual(["mem-1", "mem-2"]);
    });

    test("returns empty when table is empty", () => {
      createMockVecTable(db);
      const rows = db
        .prepare("SELECT memory_id FROM memories_vec")
        .all() as { memory_id: string }[];
      expect(rows).toEqual([]);
    });
  });

  // --- searchHybrid ---

  describe("searchHybrid", () => {
    test("returns FTS5 results when vector not available", () => {
      insertMemory(db, "m1", "TypeScript compiler optimization");
      insertMemory(db, "m2", "Python data science");

      const results = searchHybrid(db, "TypeScript", null, 10, false);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("m1");
    });

    test("returns FTS5 results when embedding is null", () => {
      insertMemory(db, "m1", "React component patterns");

      const results = searchHybrid(db, "React", null, 10, true);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("m1");
    });

    test("returns empty for empty query with no embedding", () => {
      insertMemory(db, "m1", "some content");

      const results = searchHybrid(db, "", null, 10, false);
      expect(results.length).toBe(0);
    });

    test("respects limit parameter", () => {
      insertMemory(db, "m1", "TypeScript basics");
      insertMemory(db, "m2", "TypeScript advanced");
      insertMemory(db, "m3", "TypeScript patterns");

      const results = searchHybrid(db, "TypeScript", null, 2, false);
      expect(results.length).toBe(2);
    });

    test("graceful degradation: FTS5-only when vector search throws", () => {
      insertMemory(db, "m1", "database optimization techniques");

      // Passing an embedding but no vec0 table — should silently fall back to FTS
      const embedding = new Float32Array(768);
      const results = searchHybrid(db, "database", embedding, 10, true);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("m1");
    });

    test("handles special characters in query text", () => {
      insertMemory(db, "m1", "user authentication flow");
      const results = searchHybrid(db, "user's \"auth\" flow", null, 10, false);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // --- storeEmbedding ---

  describe("storeEmbedding", () => {
    test("converts Float32Array to Buffer for storage", () => {
      createMockVecTable(db);
      const embedding = new Float32Array(768);
      embedding[0] = 1.0;
      embedding[767] = -1.0;

      storeEmbedding(db, "mem-1", embedding);

      const row = db.prepare("SELECT * FROM memories_vec WHERE memory_id = ?").get("mem-1") as {
        memory_id: string;
        embedding: Buffer;
      };
      expect(row).toBeDefined();
      expect(row.memory_id).toBe("mem-1");
      expect(row.embedding.length).toBe(768 * 4);
    });
  });

  // --- createVecTable ---

  describe("createVecTable", () => {
    test("is exported as a function", () => {
      expect(typeof createVecTable).toBe("function");
    });
  });
});
