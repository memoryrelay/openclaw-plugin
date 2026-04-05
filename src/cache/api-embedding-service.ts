import type { MemoryRelayClient } from "../client/memoryrelay-client.js";
import type { EmbeddingService } from "../pipelines/types.js";

/**
 * ApiEmbeddingService — EmbeddingService backed by the MemoryRelay API.
 *
 * Generates query embeddings server-side via POST /v1/embed.
 * No local model required — works immediately with any MemoryRelay account.
 *
 * Latency: ~50-200 ms per call (network round-trip).
 * For lower latency, replace with a local NomicEmbeddingProvider once bundled.
 *
 * Requires API to expose POST /v1/embed (see memoryrelay/api issue #375).
 */
export class ApiEmbeddingService implements EmbeddingService {
  private readonly client: MemoryRelayClient;

  constructor(client: MemoryRelayClient) {
    this.client = client;
  }

  async generateQuery(text: string): Promise<Float32Array> {
    const vec = await this.client.embed(text, "search_query");
    return new Float32Array(vec);
  }
}
