# Release Checklist

Before tagging vX.Y.Z:

- [ ] Update version in ALL 6 locations:
  - package.json → version
  - package-lock.json → version
  - openclaw.plugin.json → version
  - index.ts → JSDoc header '* Version: X.Y.Z'
  - index.ts → startup log string 'plugin vX.Y.Z loaded'
  - src/client/memoryrelay-client.ts → User-Agent header
- [ ] CHANGELOG.md → [X.Y.Z] - YYYY-MM-DD entry complete
- [ ] npm test passes (all tests green)
- [ ] git tag vX.Y.Z && git push origin vX.Y.Z (CI/CD auto-publishes to npm)

## Note on plugins install
openclaw plugins install refuses to overwrite existing extensions.
Users must: rm -rf ~/.openclaw/extensions/plugin-memoryrelay-ai first.
Workaround command:
  mkdir /tmp/mr && cd /tmp/mr && npm pack @memoryrelay/plugin-memoryrelay-ai@LATEST && tar -xzf *.tgz && rm -rf ~/.openclaw/extensions/plugin-memoryrelay-ai && cp -r package ~/.openclaw/extensions/plugin-memoryrelay-ai && rm -rf /tmp/mr && cd ~ && openclaw gateway restart

## Vector / Hybrid Search (v0.19+)

The `recallEmbedQuery` stage (position 3 of 6 in the recall pipeline) generates a
query embedding before the search stage so that local-cache lookups can use hybrid
FTS5 + vector scoring via sqlite-vec.

### Latency impact

| Configuration | Added latency per recall |
|---|---|
| `localCache.vectorSearch.enabled = false` (default) | **0 ms** — stage is skipped entirely by `enabled()` guard |
| `enabled = true`, no `embeddingService` wired | **~0 ms** — stage runs but returns immediately |
| `enabled = true`, Nomic ONNX model on CPU | **~5 ms** per query (768-dim; single-threaded inference on a mid-range x86-64 — benchmark your own hardware with `embeddingService.generateQuery` calls) |

### Config

```jsonc
// openclaw.plugin.json (or MCP server config)
{
  "localCache": {
    "vectorSearch": {
      "enabled": true,        // gates the embedQuery stage
      "provider": "sqlite-vec"
    }
  }
}
```

Embedding generation is opt-in via `localCache.vectorSearch.enabled`.  When
disabled (the default), no embedding model is loaded and no latency is added.
If embedding generation throws for any reason, the stage silently sets
`queryEmbedding = null` and the search stage falls back to FTS5-only retrieval.
