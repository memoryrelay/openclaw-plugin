import type Database from "better-sqlite3";
import type { LocalMemory } from "./types.js";

/**
 * Attempt to load the sqlite-vec extension into the database.
 * Returns true if loaded successfully, false otherwise.
 */
export async function loadVectorExtension(db: Database.Database): Promise<boolean> {
  try {
    const sqliteVec = await import("sqlite-vec");
    sqliteVec.load(db);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the vec0 virtual table for vector search.
 * Only call after loadVectorExtension returns true.
 */
export function createVecTable(db: Database.Database): void {
  const fn = (db as unknown as { exec: (sql: string) => void }).exec.bind(db);
  fn(
    "CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding float[768])",
  );
}

/**
 * Store an embedding for a memory. Upserts into the vec0 table.
 */
export function storeEmbedding(
  db: Database.Database,
  memoryId: string,
  embedding: Float32Array,
): void {
  db.prepare(
    "INSERT OR REPLACE INTO memories_vec (memory_id, embedding) VALUES (?, ?)",
  ).run(memoryId, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));
}

/**
 * Search for similar vectors. Returns memory IDs ordered by similarity.
 */
export function searchVector(
  db: Database.Database,
  queryEmbedding: Float32Array,
  limit: number,
): string[] {
  const rows = db
    .prepare(
      "SELECT memory_id FROM memories_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
    )
    .all(
      Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength),
      limit,
    ) as { memory_id: string }[];
  return rows.map((r) => r.memory_id);
}

/**
 * Hybrid search combining FTS5 text search with vector similarity.
 * Falls back to FTS5-only when queryEmbedding is null.
 */
export function searchHybrid(
  db: Database.Database,
  queryText: string,
  queryEmbedding: Float32Array | null,
  limit: number,
  vectorAvailable: boolean = true,
): LocalMemory[] {
  const resultMap = new Map<string, { memory: LocalMemory; score: number }>();

  // FTS5 search
  if (queryText.trim()) {
    const safeQuery = queryText
      .replace(/['"]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"`)
      .join(" ");

    if (safeQuery) {
      const ftsRows = db
        .prepare(
          `SELECT m.*, fts.rank
           FROM memories_fts fts
           JOIN memories m ON m.rowid = fts.rowid
           WHERE memories_fts MATCH ?
           ORDER BY fts.rank
           LIMIT ?`,
        )
        .all(safeQuery, limit * 2) as (MemoryRow & { rank: number })[];

      for (let i = 0; i < ftsRows.length; i++) {
        const row = ftsRows[i];
        const ftsScore = 1.0 - i / ftsRows.length; // normalize to 0-1
        resultMap.set(row.id, { memory: rowToMemory(row), score: ftsScore });
      }
    }
  }

  // Vector search (only if extension available and embedding provided)
  if (vectorAvailable && queryEmbedding) {
    try {
      const vecIds = searchVector(db, queryEmbedding, limit * 2);
      for (let i = 0; i < vecIds.length; i++) {
        const vecScore = 1.0 - i / vecIds.length;
        const existing = resultMap.get(vecIds[i]);
        if (existing) {
          // Boost items found by both methods
          existing.score += vecScore;
        } else {
          const row = db
            .prepare("SELECT * FROM memories WHERE id = ?")
            .get(vecIds[i]) as MemoryRow | undefined;
          if (row) {
            resultMap.set(vecIds[i], { memory: rowToMemory(row), score: vecScore });
          }
        }
      }
    } catch {
      // Vector search failed — continue with FTS results only
    }
  }

  // Sort by combined score descending, return top N
  return Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.memory);
}

// --- Internal helpers (duplicated from local-cache.ts to keep module self-contained) ---

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

function rowToMemory(row: MemoryRow): LocalMemory {
  return {
    ...row,
    metadata: JSON.parse(row.metadata),
    entities: JSON.parse(row.entities),
  };
}
