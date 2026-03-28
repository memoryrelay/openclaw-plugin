# Smart Auto-Recall & Capture — v0.16 Design Spec

**Issue:** memoryrelay/openclaw-plugin#53
**Date:** 2026-03-28
**Status:** Approved

## Goal

Production-grade recall and capture that matches or exceeds the mem0 reference implementation, seamlessly integrated into tools with zero user configuration required. Precision-first: every captured memory should be high-value and actionable.

## Architecture: Pipeline Pattern

The monolithic `index.ts` (4700+ lines) is decomposed into two pipelines — recall and capture — composed of discrete, ordered stages. Each stage has one job, a clear interface (`input → continue | skip`), and is independently testable.

```
Recall:  trigger-gate → scope-resolver → search → rank → format
Capture: trigger-gate → message-filter → content-strip → truncate → dedup → store
```

Cross-cutting concerns (session resolution, namespace routing, concurrency) live in a shared context layer.

---

## 1. Module Structure

```
openclaw-plugin/
├── index.ts                          # Entry point — wiring only (~200 lines)
├── openclaw.plugin.json
├── src/
│   ├── client/
│   │   └── memoryrelay-client.ts     # API client (~300 lines)
│   ├── context/
│   │   ├── session-resolver.ts       # Session cache, getOrCreate, lifecycle
│   │   ├── namespace-router.ts       # Agent/subagent namespace logic
│   │   └── request-context.ts        # Per-invocation immutable context
│   ├── pipelines/
│   │   ├── types.ts                  # Pipeline stage interfaces
│   │   ├── runner.ts                 # Generic pipeline executor
│   │   ├── recall/
│   │   │   ├── trigger-gate.ts       # Skip non-interactive invocations
│   │   │   ├── scope-resolver.ts     # Determine session + long-term scopes
│   │   │   ├── search.ts             # Semantic search across resolved scopes
│   │   │   ├── rank.ts               # Score/rerank (freshness, importance, tier)
│   │   │   └── format.ts             # Format for context injection
│   │   └── capture/
│   │       ├── trigger-gate.ts       # Skip non-interactive invocations
│   │       ├── message-filter.ts     # Drop noise + boilerplate (stages 1-2)
│   │       ├── content-strip.ts      # Clean useful messages (stage 3)
│   │       ├── truncate.ts           # Cap message length (stage 4)
│   │       ├── dedup.ts              # Semantic deduplication
│   │       └── store.ts             # Persist with scope + metadata
│   ├── filters/
│   │   ├── non-interactive.ts        # Shared trigger detection
│   │   ├── noise-patterns.ts         # Message-level noise rules
│   │   └── content-patterns.ts       # Content stripping rules
│   ├── hooks/
│   │   ├── before-prompt-build.ts    # Delegates to recall pipeline
│   │   ├── agent-end.ts              # Delegates to capture pipeline
│   │   ├── session-lifecycle.ts      # session_start, session_end
│   │   ├── subagent.ts              # subagent_spawned, subagent_ended
│   │   ├── compaction.ts            # before_compaction, before_reset
│   │   └── activity.ts              # after_tool_call, message_received
│   ├── tools/
│   │   ├── memory-tools.ts           # memory_store, recall, forget, list, etc.
│   │   ├── session-tools.ts          # session_start, end, recall, list
│   │   ├── entity-tools.ts           # entity_create, link, list, graph
│   │   ├── decision-tools.ts         # decision_record, list, supersede, check
│   │   ├── pattern-tools.ts          # pattern_create, search, adopt, suggest
│   │   ├── project-tools.ts          # project_register, list, info, etc.
│   │   ├── agent-tools.ts            # agent_list, create, get
│   │   └── v2-tools.ts               # memory_store_async, status, context_build
│   ├── debug-logger.ts
│   ├── status-reporter.ts
│   ├── cli/
│   │   └── stats-command.ts
│   ├── heartbeat/
│   │   └── daily-stats.ts
│   └── onboarding/
│       └── first-run.ts
├── skills/                            # Unchanged
└── tests/
    ├── pipelines/
    │   ├── recall/                    # Per-stage unit tests
    │   └── capture/                   # Per-stage unit tests
    ├── filters/                       # Filter unit tests
    ├── context/                       # Context layer tests
    └── integration/                   # End-to-end pipeline tests
```

`index.ts` becomes pure wiring: imports modules, registers hooks/tools, passes config. Existing modules (`debug-logger`, `status-reporter`, `cli/`, `heartbeat/`, `onboarding/`) stay in place.

---

## 2. Pipeline Stage Interface

Every pipeline stage conforms to a single interface. The runner executes stages in order, short-circuiting on `skip`.

```typescript
interface PipelineContext {
  readonly requestCtx: RequestContext;
  readonly config: PluginConfig;
  readonly client: MemoryRelayClient;
}

// Recall
interface RecallStage {
  name: string;
  enabled: (ctx: PipelineContext) => boolean;
  execute: (input: RecallInput, ctx: PipelineContext) => Promise<RecallResult>;
}

interface RecallInput {
  prompt: string;
  memories: Memory[];
  scope: "session" | "long-term" | "all";
  // Progressive enrichment — stages add these fields as data flows through:
  resolvedSessionKey?: string;         // Added by scope-resolver
  longTerm?: ScoredMemory[];           // Added by search, refined by rank
  session?: ScoredMemory[];            // Added by search, refined by rank
  formatted?: string;                  // Added by format
}

interface ScoredMemory {
  memory: Memory;
  finalScore: number;
}

type RecallResult =
  | { action: "continue"; data: RecallInput }
  | { action: "skip" };

// Capture
interface CaptureStage {
  name: string;
  enabled: (ctx: PipelineContext) => boolean;
  execute: (input: CaptureInput, ctx: PipelineContext) => Promise<CaptureResult>;
}

interface CaptureInput {
  messages: ConversationMessage[];
}

type CaptureResult =
  | { action: "continue"; data: CaptureInput }
  | { action: "skip" };
```

**Pipeline runner** — generic, works for both:

```typescript
async function runPipeline<TStage, TInput>(
  stages: TStage[],
  input: TInput,
  ctx: PipelineContext,
): Promise<TInput | null> {
  let current = input;
  for (const stage of stages) {
    if (!stage.enabled(ctx)) continue;
    const result = await stage.execute(current, ctx);
    if (result.action === "skip") return null;
    current = result.data;
  }
  return current;
}
```

Stage ordering is explicit, defined in the wiring:

```typescript
const recallPipeline: RecallStage[] = [
  triggerGate, scopeResolver, search, rank, format,
];

const capturePipeline: CaptureStage[] = [
  triggerGate, messageFilter, contentStrip, truncate, dedup, store,
];
```

Each stage checks `enabled(ctx)` against config. Users can disable stages via plugin config without touching code.

---

## 3. Request Context & Concurrency Safety

Replaces shared mutable `currentSessionId` with an immutable, per-invocation context object.

```typescript
interface RequestContext {
  readonly sessionKey: string;
  readonly agentId: string | null;
  readonly channel: string | null;
  readonly trigger: string | null;
  readonly prompt: string;
  readonly isSubagent: boolean;
  readonly parentSessionKey: string | null;
  readonly namespace: string;
  readonly timestamp: number;
}

function buildRequestContext(event: HookEvent, config: PluginConfig): RequestContext {
  const sessionKey = event.ctx?.sessionKey ?? event.sessionId ?? "";
  const subagentMatch = sessionKey.match(/^agent:([^:]+):subagent:(.+)$/);
  const agentMatch = sessionKey.match(/^agent:([^:]+):(.+)$/);

  const isSubagent = !!subagentMatch;
  const agentId = subagentMatch?.[1] ?? agentMatch?.[1] ?? config.agentId ?? null;
  const parentSessionKey = isSubagent
    ? sessionKey.replace(/:subagent:[^:]+$/, `:${subagentMatch![2]}`)
    : null;

  return Object.freeze({
    sessionKey,
    agentId,
    channel: event.channel ? String(event.channel) : null,
    trigger: event.ctx?.trigger ?? null,
    prompt: event.prompt?.trim() ?? "",
    isSubagent,
    parentSessionKey,
    namespace: resolveNamespace(agentId, config),
    timestamp: Date.now(),
  });
}
```

Hooks create a `RequestContext` from their event, pass it through the pipeline. No shared state. Concurrent sessions are fully isolated.

---

## 4. Non-Interactive Trigger Detection

Shared gate used by both pipelines. Non-configurable safety net.

```typescript
const NON_INTERACTIVE_TRIGGERS = new Set([
  "cron", "heartbeat", "schedule", "automation", "health_check",
]);

const NON_INTERACTIVE_SESSION_PATTERNS = [
  /:cron:/, /:heartbeat:/, /:schedule:/, /:automation:/,
];

const EMPTY_PROMPTS = new Set([
  "HEARTBEAT_OK", "NO_REPLY", "HEALTH_CHECK", "PING",
]);

function isNonInteractive(signals: TriggerSignals): boolean {
  if (signals.trigger && NON_INTERACTIVE_TRIGGERS.has(signals.trigger)) return true;
  if (NON_INTERACTIVE_SESSION_PATTERNS.some(p => p.test(signals.sessionKey))) return true;
  if (!signals.prompt || signals.prompt.length < 5) return true;
  if (EMPTY_PROMPTS.has(signals.prompt)) return true;
  return false;
}
```

Pure function, easy to unit test. Both pipeline trigger gates delegate to this.

---

## 5. Namespace Routing & Subagent Handling

Determines where memories are stored and retrieved from.

```typescript
interface NamespaceConfig {
  isolateAgents: boolean;          // Default: false
  subagentPolicy: "inherit" | "isolate" | "skip";  // Default: "inherit"
}

function resolveNamespace(agentId: string | null, config: PluginConfig): string {
  const nsConfig = { ...DEFAULTS, ...config.namespace };
  if (!nsConfig.isolateAgents || !agentId) return "default";
  return `agent:${agentId}`;
}
```

**Subagent policies:**

| Policy | Recall | Capture | Use case |
|--------|--------|---------|----------|
| `"inherit"` | Search parent's namespace | Store under parent | Default — subagent enriches main context |
| `"isolate"` | Own namespace only | Store under own | Long-lived specialized agents |
| `"skip"` | No recall | No capture | Ephemeral utility subagents |

When a subagent inherits parent memories, the format stage prepends: *"These memories belong to the parent session. Use for context only."*

---

## 6. Capture Pipeline — Noise Filtering

Precision-first, multi-stage, subtractive. Each stage removes noise; nothing adds speculative content.

### Stage 1 — Message Filter (drop entire messages)

```typescript
const DROP_PATTERNS = {
  systemTriggers: /^(HEARTBEAT_OK|NO_REPLY|HEALTH_CHECK|PING)$/,
  timestamps: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  acks: /^(ok|okay|sure|done|yes|no|thanks|thank you|got it|right|yep|nope|k|ty|thx|np|ack|fine|cool|great|perfect)\.?$/i,
  routingBlocks: /^<(?:system-reminder|routing|metadata|tool-result)>/,
  bareToolCalls: /^<tool_call>[\s\S]*<\/tool_call>$/,
  compactionLogs: /^<compaction-audit>/,
};

function shouldDropMessage(message: ConversationMessage): boolean {
  const text = message.content.trim();
  if (text.length < 10) return true;
  return Object.values(DROP_PATTERNS).some(p => p.test(text));
}
```

### Stage 2 — Boilerplate Detection (assistant filler)

Scores assistant messages on information density — boilerplate signals vs content length. Short assistant messages with high boilerplate ratio are dropped.

```typescript
const BOILERPLATE_SIGNALS = [
  /^(I see|I understand|Got it|Sure|Let me|I'll|I can|Here's what)/i,
  /how can I help/i,
  /let me know if/i,
  /is there anything else/i,
  /happy to help/i,
];

function isAssistantBoilerplate(message: ConversationMessage): boolean {
  if (message.role !== "assistant") return false;
  const text = message.content.trim();
  if (text.length > 300) return false;
  const signalCount = BOILERPLATE_SIGNALS.filter(p => p.test(text)).length;
  const density = signalCount / (text.length / 100);
  return density > 0.5;
}
```

### Stage 3 — Content Strip (clean useful messages)

Removes embedded blocks from otherwise valuable messages:

- `<memoryrelay-workflow>` blocks
- `<relevant-memories>` blocks
- `<compaction-summary>` blocks
- `<system-reminder>` blocks
- Media/attachment references
- Code blocks over 500 characters

After stripping, collapses whitespace gaps. Drops messages left with < 10 characters.

### Stage 4 — Truncate

Caps individual messages at configurable `maxMessageLength` (default: 2000 characters).

---

## 7. Session-Scoped Memories

Two memory scopes that work together seamlessly. No user action required.

- **Session (short-term)** — scoped to current conversation, auto-expires
- **Long-term** — persistent across sessions

### Auto-scoping rules for capture

Default to session scope. Promote to long-term only when content matches long-term signals:

```typescript
const LONG_TERM_SIGNALS = [
  /(?:always|never|prefer|don't like|my name is|i work at)/i,
  /(?:remember|important|note that|keep in mind)/i,
  /(?:api key|endpoint|server|credentials|config)/i,
  /(?:decision|chose|decided|agreed|approved)/i,
  /(?:pattern|convention|standard|rule)/i,
];

function resolveScope(content: string): "session" | "long-term" {
  if (LONG_TERM_SIGNALS.some(p => p.test(content))) return "long-term";
  return "session";
}
```

### Recall formatting

Long-term and session memories are presented separately in the context injection:

```xml
<long-term-memories>
- persistent fact 1
- persistent fact 2
</long-term-memories>

<session-memories>
- contextual item from this conversation
</session-memories>
```

### Tool surface changes

Backward-compatible additions:

| Tool | New parameter | Default |
|------|--------------|---------|
| `memory_store` | `scope: "session" \| "long-term"` | `"long-term"` |
| `memory_search` | `scope: "session" \| "long-term" \| "all"` | `"all"` |
| `memory_list` | `scope: "session" \| "long-term" \| "all"` | `"all"` |
| `memory_promote` | Can now promote session → long-term | — |

---

## 8. Recall Pipeline — Search, Rank, Format

### Search

Queries both scopes in parallel — no extra latency:

```typescript
const [longTerm, session] = await Promise.all([
  client.search(prompt, limit, threshold, { scope: "long-term", namespace }),
  client.search(prompt, limit, threshold, { scope: "session", session_id: resolvedSessionKey, namespace }),
]);
```

### Rank

Composite scoring combines:

- **Semantic similarity** (0-1, base score)
- **Freshness boost** (+0.1 max, memories < 24h)
- **Importance boost** (+0.1 max, from `memory.importance`)
- **Tier boost** (+0.05 for `hot` tier)

```typescript
function scoreMemory(memory: Memory, similarity: number): number {
  let score = similarity;
  const ageHours = (Date.now() - new Date(memory.created_at).getTime()) / 3_600_000;
  if (ageHours < 24) score += 0.1 * (1 - ageHours / 24);
  if (memory.importance != null) score += 0.1 * memory.importance;
  if (memory.tier === "hot") score += 0.05;
  return Math.min(score, 1.0);
}
```

`recallLimit` applies per scope — up to N long-term + N session results.

---

## 9. Session Resolution

Thread-safe session cache with deduplication of in-flight creates.

```typescript
class SessionResolver {
  private readonly cache = new Map<string, SessionEntry>();
  private readonly pending = new Map<string, Promise<SessionEntry>>();

  async resolve(requestCtx: RequestContext): Promise<SessionEntry> {
    const key = requestCtx.sessionKey;
    const cached = this.cache.get(key);
    if (cached && !this.isStale(cached)) {
      cached.lastActivityAt = Date.now();
      return cached;
    }
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const promise = this.createSession(requestCtx);
    this.pending.set(key, promise);
    try {
      const entry = await promise;
      this.cache.set(key, entry);
      return entry;
    } finally {
      this.pending.delete(key);
    }
  }

  async cleanupStale(): Promise<void> {
    for (const [key, entry] of this.cache) {
      if (this.isStale(entry)) {
        await this.endSession(key).catch(() => {});
      }
    }
  }
}
```

Stale cleanup runs on `sessionCleanupIntervalMinutes` interval (default: 30 min). Timeout is `sessionTimeoutMinutes` (default: 120 min).

---

## 10. Plugin Config

All new behavior has smart defaults. Zero config required. Full user override via UI or SDK.

### New config fields

```typescript
{
  // Namespace (new)
  namespace: {
    isolateAgents: boolean;               // Default: false
    subagentPolicy: "inherit" | "isolate" | "skip";  // Default: "inherit"
  },

  // Capture (extended)
  autoCapture: {
    // ... existing fields ...
    maxMessageLength: number;             // Default: 2000
    stripLargeCodeBlocks: boolean;        // Default: true
  },

  // Ranking (new)
  ranking: {
    freshnessBoost: boolean;              // Default: true
    freshnessWindowHours: number;         // Default: 24
    importanceBoost: boolean;             // Default: true
    tierBoost: boolean;                   // Default: true
  },
}
```

### Non-configurable safety gates

- Trigger detection (non-interactive skip)
- Blocklist patterns (credentials, PII)
- `Object.freeze` on request context

---

## Testing Strategy

### Unit tests (per module)

- Each pipeline stage: given input + config, assert output or skip
- `isNonInteractive()`: all signal combinations
- `resolveNamespace()`: agent/subagent/default cases
- `buildRequestContext()`: various event shapes
- `scoreMemory()`: freshness, importance, tier edge cases
- Noise patterns: message filter, boilerplate detection, content stripping

### Integration tests

- Full recall pipeline: event → context injection string
- Full capture pipeline: conversation messages → stored memories with correct scope
- Concurrent session resolution: parallel resolves for same and different keys
- Subagent routing: inherit, isolate, skip policies end-to-end

### Backward compatibility

- Existing config shapes produce identical behavior to v0.15.8
- Tools without new `scope` parameter default to current behavior
- No breaking changes to tool names, parameters, or response shapes

---

## Out of Scope

- ML-based content classification (future enhancement)
- Memory retention policies / TTL (separate issue)
- API-side changes (API already supports all required features)
- Skills modifications (unchanged)
- Command changes (unchanged)
