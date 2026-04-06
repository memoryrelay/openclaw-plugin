import { describe, test, expect, vi } from "vitest";
import { ApiEmbeddingService } from "../../src/cache/api-embedding-service.js";
import type { MemoryRelayClient } from "../../src/pipelines/types.js";

function makeClient(embedding: number[] = new Array(768).fill(0.1)) {
  return {
    embed: vi.fn().mockResolvedValue(embedding),
  } as unknown as MemoryRelayClient;
}

describe("ApiEmbeddingService", () => {
  test("generateQuery calls client.embed with search_query prefix", async () => {
    const client = makeClient();
    const svc = new ApiEmbeddingService(client);
    await svc.generateQuery("find IDE themes");
    expect(client.embed).toHaveBeenCalledWith("find IDE themes", "search_query");
  });

  test("generateQuery returns Float32Array", async () => {
    const client = makeClient(new Array(768).fill(0.5));
    const svc = new ApiEmbeddingService(client);
    const result = await svc.generateQuery("test query");
    expect(result).toBeInstanceOf(Float32Array);
  });

  test("generateQuery returns correct dimension", async () => {
    const client = makeClient(new Array(768).fill(0.1));
    const svc = new ApiEmbeddingService(client);
    const result = await svc.generateQuery("test");
    expect(result.length).toBe(768);
  });

  test("generateQuery converts number[] to Float32Array correctly", async () => {
    const raw = [0.1, 0.2, 0.3];
    const client = makeClient(raw);
    const svc = new ApiEmbeddingService(client);
    const result = await svc.generateQuery("test");
    expect(result[0]).toBeCloseTo(0.1);
    expect(result[1]).toBeCloseTo(0.2);
    expect(result[2]).toBeCloseTo(0.3);
  });

  test("propagates errors from client.embed", async () => {
    const client = {
      embed: vi.fn().mockRejectedValue(new Error("API error")),
    } as unknown as MemoryRelayClient;
    const svc = new ApiEmbeddingService(client);
    await expect(svc.generateQuery("test")).rejects.toThrow("API error");
  });
});
