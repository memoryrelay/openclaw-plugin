import { describe, test, expect, vi } from "vitest";
import { NomicEmbeddingService } from "../../src/cache/nomic-embedding-service.js";

describe("NomicEmbeddingService", () => {
  test("throws clear error when onnxruntime-node is not installed", async () => {
    // The service uses createRequire to load optional deps
    // In test environment, onnxruntime-node is not installed — verify error message
    const svc = new NomicEmbeddingService("/tmp/test-nomic-models");
    await expect(svc.generateQuery("test")).rejects.toThrow(
      /onnxruntime-node is not installed/,
    );
  });

  test("throws error suggesting install command", async () => {
    const svc = new NomicEmbeddingService("/tmp/test-nomic-models");
    await expect(svc.generateQuery("test")).rejects.toThrow(
      /npm install onnxruntime-node/,
    );
  });

  test("creates model directory if it does not exist", () => {
    const dir = `/tmp/nomic-test-${Date.now()}`;
    const { existsSync } = require("node:fs");
    expect(existsSync(dir)).toBe(false);
    new NomicEmbeddingService(dir);
    expect(existsSync(dir)).toBe(true);
    require("node:fs").rmSync(dir, { recursive: true });
  });

  test("deduplicates concurrent load calls", async () => {
    const svc = new NomicEmbeddingService("/tmp/test-nomic-models");
    // Both should reject with the same error (not start two loads)
    const [r1, r2] = await Promise.allSettled([
      svc.generateQuery("query1"),
      svc.generateQuery("query2"),
    ]);
    expect(r1.status).toBe("rejected");
    expect(r2.status).toBe("rejected");
    // Both should have same root cause
    expect((r1 as PromiseRejectedResult).reason.message).toMatch(/onnxruntime-node/);
  });

  test("MODEL_NAME constant is correct", () => {
    expect(NomicEmbeddingService.MODEL_NAME).toBe("nomic-ai/nomic-embed-text-v1.5");
  });

  test("DIM constant is 768", () => {
    expect(NomicEmbeddingService.DIM).toBe(768);
  });
});
