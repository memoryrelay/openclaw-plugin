import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EmbeddingService } from "../pipelines/types.js";

/**
 * NomicEmbeddingService — local ONNX EmbeddingService using nomic-embed-text-v1.5.
 *
 * Generates query embeddings locally (768 dims) with ~5ms per-call latency.
 * Model is downloaded once (~131 MB) to modelDir on first use.
 *
 * Optional peer deps required: onnxruntime-node + @xenova/transformers
 * Install: npm install onnxruntime-node @xenova/transformers
 *
 * Activation: set `localCache.vectorSearch.provider = "nomic"` in config.
 */
export class NomicEmbeddingService implements EmbeddingService {
  private session: any = null;
  private tokenizer: any = null;
  private loading: Promise<void> | null = null;
  private _tensorClass: any = null;
  private readonly modelDir: string;

  static readonly MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5";
  static readonly ONNX_FILE = "onnx/model_quantized.onnx";
  static readonly DIM = 768;

  constructor(modelDir: string) {
    this.modelDir = modelDir;
    if (!existsSync(modelDir)) {
      mkdirSync(modelDir, { recursive: true });
    }
  }

  async generateQuery(text: string): Promise<Float32Array> {
    await this.ensureLoaded();
    return this._embed(`search_query: ${text}`);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.session && this.tokenizer) return;
    if (this.loading) return this.loading;
    this.loading = this._load();
    return this.loading;
  }

  private async _load(): Promise<void> {
    const req = createRequire(import.meta.url);
    let ort: any;
    let transformers: any;
    try {
      ort = req("onnxruntime-node");
    } catch {
      throw new Error(
        "onnxruntime-node is not installed.\n" +
          "Run: npm install onnxruntime-node @xenova/transformers\n" +
          "Or use provider='api' (default, no install required).",
      );
    }
    try {
      transformers = req("@xenova/transformers");
    } catch {
      throw new Error(
        "@xenova/transformers is not installed.\n" +
          "Run: npm install onnxruntime-node @xenova/transformers\n" +
          "Or use provider='api' (default, no install required).",
      );
    }

    process.stdout.write(
      `[memoryrelay] Loading Nomic embedding model (first time: ~131 MB download to ${this.modelDir})...\n`,
    );

    const { AutoTokenizer, env } = transformers;
    env.cacheDir = this.modelDir;
    env.allowLocalModels = true;

    this.tokenizer = await AutoTokenizer.from_pretrained(NomicEmbeddingService.MODEL_NAME);

    const modelPath = join(
      this.modelDir,
      NomicEmbeddingService.MODEL_NAME,
      NomicEmbeddingService.ONNX_FILE,
    );
    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      logSeverityLevel: 3,
    });
    this._tensorClass = ort.Tensor;

    process.stdout.write(`[memoryrelay] Nomic model ready (${NomicEmbeddingService.DIM} dims)\n`);
  }

  private async _embed(text: string): Promise<Float32Array> {
    const encoded = await this.tokenizer(text, {
      truncation: true,
      max_length: 512,
      return_tensors: "np",
    });

    const inputIds = BigInt64Array.from(
      Array.from(encoded.input_ids.data as number[]).map(BigInt),
    );
    const attentionMask = BigInt64Array.from(
      Array.from(encoded.attention_mask.data as number[]).map(BigInt),
    );
    const seqLen = inputIds.length;
    const dim = NomicEmbeddingService.DIM;

    const feeds = {
      input_ids: new this._tensorClass("int64", inputIds, [1, seqLen]),
      attention_mask: new this._tensorClass("int64", attentionMask, [1, seqLen]),
    };

    const results = await this.session.run(feeds);
    const key = results.last_hidden_state ? "last_hidden_state" : Object.keys(results)[0];
    const lastHidden: Float32Array = results[key].data;

    // Mean pool over sequence dimension
    const pooled = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {
      let sum = 0;
      for (let s = 0; s < seqLen; s++) sum += lastHidden[s * dim + d];
      pooled[d] = sum / seqLen;
    }

    // L2 normalize for cosine similarity
    const norm = Math.sqrt(pooled.reduce((acc, v) => acc + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dim; i++) pooled[i] /= norm;
    }

    return pooled;
  }
}
