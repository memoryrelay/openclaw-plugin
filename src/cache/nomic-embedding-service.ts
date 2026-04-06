import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EmbeddingService } from "../pipelines/types.js";

/**
 * NomicEmbeddingService — local ONNX EmbeddingService using nomic-embed-text-v1.5.
 *
 * Generates query embeddings locally (768 dims) with ~5ms per-call latency
 * after the model is loaded. No network requests required at query time.
 *
 * Model is downloaded once (~131 MB) to the specified cache directory on first use.
 * Uses onnxruntime-node + @xenova/transformers — both are optional peer dependencies.
 *
 * Activation: set `localCache.vectorSearch.provider = "nomic"` in config.
 * Falls back to ApiEmbeddingService if onnxruntime-node is not installed.
 */
export class NomicEmbeddingService implements EmbeddingService {
  private session: any = null;
  private tokenizer: any = null;
  private loading: Promise<void> | null = null;
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async ensureLoaded(): Promise<void> {
    if (this.session && this.tokenizer) return;
    if (this.loading) return this.loading;
    this.loading = this._load();
    return this.loading;
  }

  private async _load(): Promise<void> {
    // Dynamic import of optional peer deps — fail gracefully if not installed
    let ort: any;
    let transformers: any;
    try {
      const req = createRequire(import.meta.url);
      ort = req("onnxruntime-node");
    } catch {
      throw new Error(
        "onnxruntime-node is not installed. Run: npm install onnxruntime-node\n" +
          "Or use provider='api' (server-side embeddings, no install required).",
      );
    }
    try {
      const req = createRequire(import.meta.url);
      transformers = req("@xenova/transformers");
    } catch {
      throw new Error(
        "@xenova/transformers is not installed. Run: npm install @xenova/transformers\n" +
          "Or use provider='api' (server-side embeddings, no install required).",
      );
    }

    // Download model files on first use (cached to modelDir)
    process.stdout.write(
      `[memoryrelay] Downloading Nomic embedding model to ${this.modelDir} (first time only, ~131 MB)...\n`,
    );

    // Use @xenova/transformers for tokenizer + model file management
    const { AutoTokenizer, env } = transformers;
    env.cacheDir = this.modelDir;
    env.allowLocalModels = true;

    this.tokenizer = await AutoTokenizer.from_pretrained(NomicEmbeddingService.MODEL_NAME);

    // Load ONNX session
    const modelPath = join(this.modelDir, NomicEmbeddingService.MODEL_NAME, NomicEmbeddingService.ONNX_FILE);
    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      logSeverityLevel: 3, // suppress verbose ONNX logs
    });

    process.stdout.write(`[memoryrelay] Nomic embedding model loaded (${NomicEmbeddingService.DIM} dims)\n`);
  }

  private async _embed(text: string): Promise<Float32Array> {
    const encoded = await this.tokenizer(text, {
      truncation: true,
      max_length: 512,
      return_tensors: "np",
    });

    const inputIds = BigInt64Array.from(Array.from(encoded.input_ids.data as number[]).map(BigInt));
    const attentionMask = BigInt64Array.from(Array.from(encoded.attention_mask.data as number[]).map(BigInt));
    const seqLen = inputIds.length;

    const feeds = {
      input_ids: new (await this._OrtTensor())(
        "int64",
        inputIds,
        [1, seqLen],
      ),
      attention_mask: new (await this._OrtTensor())(
        "int64",
        attentionMask,
        [1, seqLen],
      ),
    };

    const results = await this.session.run(feeds);
    const lastHidden: Float32Array = results.last_hidden_state?.data ?? results[Object.keys(results)[0]].data;

    // Mean pooling over the sequence dimension
    const dim = NomicEmbeddingService.DIM;
    const pooled = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {
      let sum = 0;
      for (let s = 0; s < seqLen; s++) {
        sum += lastHidden[s * dim + d];
      }
      pooled[d] = sum / seqLen;
    }

    // L2 normalize (cosine similarity = dot product after normalization)
    const norm = Math.sqrt(pooled.reduce((acc, v) => acc + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dim; i++) pooled[i] /= norm;
    }

    return pooled;
  }

  /** Lazy-load the ORT Tensor class */
  private _tensorClass: any = null;
  private async _OrtTensor(): Promise<any> {
    if (this._tensorClass) return this._tensorClass;
    const req = createRequire(import.meta.url);
    const ort = req("onnxruntime-node");
    this._tensorClass = ort.Tensor;
    return this._tensorClass;
  }
}
