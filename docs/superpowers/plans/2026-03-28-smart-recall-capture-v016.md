# Smart Auto-Recall & Capture v0.16 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the monolithic `index.ts` into a pipeline architecture with smart recall, precision-first capture, session-scoped memories, namespace routing, and concurrency safety.

**Architecture:** Two pipelines (recall: 5 stages, capture: 6 stages) composed of discrete stages with shared filter library. Cross-cutting concerns (session resolution, namespace routing, concurrency) in a context layer. Monolithic `index.ts` (~5700 lines) becomes ~200 lines of wiring.

**Tech Stack:** TypeScript, Vitest, OpenClaw Plugin SDK

**Spec:** `docs/superpowers/specs/2026-03-28-smart-recall-capture-v016-design.md`

---

## File Map

### New files to create

| File | Responsibility |
|------|---------------|
| `src/pipelines/types.ts` | Pipeline stage interfaces, shared types |
| `src/pipelines/runner.ts` | Generic pipeline executor |
| `src/pipelines/recall/trigger-gate.ts` | Skip non-interactive for recall |
| `src/pipelines/recall/scope-resolver.ts` | Determine session + long-term scopes |
| `src/pipelines/recall/search.ts` | Semantic search across scopes |
| `src/pipelines/recall/rank.ts` | Composite scoring (similarity + freshness + importance + tier) |
| `src/pipelines/recall/format.ts` | Format memories for context injection |
| `src/pipelines/recall/index.ts` | Export assembled recall pipeline |
| `src/pipelines/capture/trigger-gate.ts` | Skip non-interactive for capture |
| `src/pipelines/capture/message-filter.ts` | Drop noise + boilerplate messages |
| `src/pipelines/capture/content-strip.ts` | Clean useful messages |
| `src/pipelines/capture/truncate.ts` | Cap message length |
| `src/pipelines/capture/dedup.ts` | Semantic deduplication |
| `src/pipelines/capture/store.ts` | Persist with scope + metadata |
| `src/pipelines/capture/index.ts` | Export assembled capture pipeline |
| `src/filters/non-interactive.ts` | Shared trigger detection |
| `src/filters/noise-patterns.ts` | Message-level noise rules |
| `src/filters/content-patterns.ts` | Content stripping rules |
| `src/context/request-context.ts` | Per-invocation immutable context |
| `src/context/namespace-router.ts` | Agent/subagent namespace logic |
| `src/context/session-resolver.ts` | Session cache with concurrency safety |
| `src/client/memoryrelay-client.ts` | API client extracted from index.ts |
| `src/hooks/before-prompt-build.ts` | Recall pipeline hook |
| `src/hooks/agent-end.ts` | Capture pipeline hook |
| `src/hooks/session-lifecycle.ts` | session_start, session_end |
| `src/hooks/subagent.ts` | subagent_spawned, subagent_ended |
| `src/hooks/compaction.ts` | before_compaction, before_reset |
| `src/hooks/activity.ts` | after_tool_call, message_received, message_sending |
| `src/hooks/privacy.ts` | before_message_write, tool_result_persist |
| `src/tools/memory-tools.ts` | 9 memory tools |
| `src/tools/session-tools.ts` | 4 session tools |
| `src/tools/entity-tools.ts` | 4 entity tools |
| `src/tools/decision-tools.ts` | 4 decision tools |
| `src/tools/pattern-tools.ts` | 4 pattern tools |
| `src/tools/project-tools.ts` | 10 project tools |
| `src/tools/agent-tools.ts` | 3 agent tools |
| `src/tools/v2-tools.ts` | 3 v2 async tools |
| `src/tools/health-tools.ts` | 1 health tool |
| `tests/filters/non-interactive.test.ts` | Trigger detection tests |
| `tests/filters/noise-patterns.test.ts` | Noise pattern tests |
| `tests/filters/content-patterns.test.ts` | Content stripping tests |
| `tests/context/request-context.test.ts` | Request context tests |
| `tests/context/namespace-router.test.ts` | Namespace routing tests |
| `tests/context/session-resolver.test.ts` | Session resolver tests |
| `tests/pipelines/recall/trigger-gate.test.ts` | Recall trigger gate tests |
| `tests/pipelines/recall/scope-resolver.test.ts` | Scope resolver tests |
| `tests/pipelines/recall/search.test.ts` | Search stage tests |
| `tests/pipelines/recall/rank.test.ts` | Rank stage tests |
| `tests/pipelines/recall/format.test.ts` | Format stage tests |
| `tests/pipelines/capture/trigger-gate.test.ts` | Capture trigger gate tests |
| `tests/pipelines/capture/message-filter.test.ts` | Message filter tests |
| `tests/pipelines/capture/content-strip.test.ts` | Content strip tests |
| `tests/pipelines/capture/truncate.test.ts` | Truncate tests |
| `tests/pipelines/capture/dedup.test.ts` | Dedup tests |
| `tests/pipelines/capture/store.test.ts` | Store tests |
| `tests/pipelines/runner.test.ts` | Pipeline runner tests |
| `tests/integration/recall-pipeline.test.ts` | End-to-end recall tests |
| `tests/integration/capture-pipeline.test.ts` | End-to-end capture tests |

### Files to modify

| File | Change |
|------|--------|
| `index.ts` | Gut to ~200 lines of wiring — imports + registration |
| `openclaw.plugin.json` | Add namespace, ranking config schema |
| `package.json` | Bump to 0.16.0 |

### Files unchanged

`src/debug-logger.ts`, `src/status-reporter.ts`, `src/cli/stats-command.ts`, `src/heartbeat/daily-stats.ts`, `src/onboarding/first-run.ts`, `skills/`

---

## Task 1: Pipeline Types & Runner

**Files:**
- Create: `src/pipelines/types.ts`
- Create: `src/pipelines/runner.ts`
- Test: `tests/pipelines/runner.test.ts`

- [ ] **Step 1: Write the pipeline runner test**

```typescript
// tests/pipelines/runner.test.ts
import { describe, test, expect } from "vitest";
import { runPipeline } from "../../src/pipelines/runner.js";
import type { PipelineContext, RecallStage, RecallInput, CaptureStage, CaptureInput } from "../../src/pipelines/types.js";

// Minimal mock context for testing
function mockPipelineContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "test-session",
      agentId: "test-agent",
      channel: null,
      trigger: null,
      prompt: "test prompt",
      isSubagent: false,
      parentSessionKey: null,
      namespace: "default",
      timestamp: Date.now(),
    },
    config: {} as any,
    client: {} as any,
    ...overrides,
  };
}

describe("runPipeline", () => {
  test("executes stages in order and returns final output", async () => {
    const log: string[] = [];

    const stage1: RecallStage = {
      name: "stage1",
      enabled: () => true,
      execute: async (input, _ctx) => {
        log.push("stage1");
        return { action: "continue", data: { ...input, prompt: input.prompt + "-s1" } };
      },
    };

    const stage2: RecallStage = {
      name: "stage2",
      enabled: () => true,
      execute: async (input, _ctx) => {
        log.push("stage2");
        return { action: "continue", data: { ...input, prompt: input.prompt + "-s2" } };
      },
    };

    const input: RecallInput = { prompt: "hello", memories: [], scope: "all" };
    const result = await runPipeline([stage1, stage2], input, mockPipelineContext());

    expect(result).not.toBeNull();
    expect(result!.prompt).toBe("hello-s1-s2");
    expect(log).toEqual(["stage1", "stage2"]);
  });

  test("short-circuits on skip", async () => {
    const log: string[] = [];

    const stage1: RecallStage = {
      name: "skipper",
      enabled: () => true,
      execute: async (_input, _ctx) => {
        log.push("skipper");
        return { action: "skip" };
      },
    };

    const stage2: RecallStage = {
      name: "never-reached",
      enabled: () => true,
      execute: async (input, _ctx) => {
        log.push("never-reached");
        return { action: "continue", data: input };
      },
    };

    const input: RecallInput = { prompt: "hello", memories: [], scope: "all" };
    const result = await runPipeline([stage1, stage2], input, mockPipelineContext());

    expect(result).toBeNull();
    expect(log).toEqual(["skipper"]);
  });

  test("skips disabled stages", async () => {
    const log: string[] = [];

    const enabled: RecallStage = {
      name: "enabled",
      enabled: () => true,
      execute: async (input, _ctx) => {
        log.push("enabled");
        return { action: "continue", data: input };
      },
    };

    const disabled: RecallStage = {
      name: "disabled",
      enabled: () => false,
      execute: async (input, _ctx) => {
        log.push("disabled");
        return { action: "continue", data: input };
      },
    };

    const input: RecallInput = { prompt: "hello", memories: [], scope: "all" };
    await runPipeline([enabled, disabled, enabled], input, mockPipelineContext());

    expect(log).toEqual(["enabled", "enabled"]);
  });

  test("returns input unchanged when all stages are disabled", async () => {
    const disabled: RecallStage = {
      name: "disabled",
      enabled: () => false,
      execute: async (input, _ctx) => ({ action: "continue", data: input }),
    };

    const input: RecallInput = { prompt: "unchanged", memories: [], scope: "all" };
    const result = await runPipeline([disabled], input, mockPipelineContext());

    expect(result).toEqual(input);
  });

  test("works with empty stage array", async () => {
    const input: RecallInput = { prompt: "empty", memories: [], scope: "all" };
    const result = await runPipeline([], input, mockPipelineContext());
    expect(result).toEqual(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/pipelines/runner.test.ts`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Write pipeline types**

```typescript
// src/pipelines/types.ts

export interface Memory {
  id: string;
  content: string;
  agent_id: string;
  user_id: string;
  metadata: Record<string, string>;
  entities: string[];
  created_at: string;
  updated_at: string;
  importance?: number;
  tier?: "hot" | "warm" | "cold";
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ScoredMemory {
  memory: Memory;
  finalScore: number;
}

export interface RequestContext {
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

export interface PluginConfig {
  apiKey?: string;
  agentId?: string;
  apiUrl?: string;
  defaultProject?: string;
  autoRecall?: boolean;
  recallLimit?: number;
  recallThreshold?: number;
  excludeChannels?: string[];
  autoCapture?: {
    enabled: boolean;
    tier: "off" | "conservative" | "smart" | "aggressive";
    confirmFirst?: number;
    maxMessageLength?: number;
    stripLargeCodeBlocks?: boolean;
    categories?: {
      credentials?: boolean;
      preferences?: boolean;
      technical?: boolean;
      personal?: boolean;
    };
    blocklist?: string[];
  };
  namespace?: {
    isolateAgents?: boolean;
    subagentPolicy?: "inherit" | "isolate" | "skip";
  };
  ranking?: {
    freshnessBoost?: boolean;
    freshnessWindowHours?: number;
    importanceBoost?: boolean;
    tierBoost?: boolean;
  };
  sessionTimeoutMinutes?: number;
  sessionCleanupIntervalMinutes?: number;
  debug?: boolean;
  verbose?: boolean;
  maxLogEntries?: number;
  logFile?: string;
}

export interface MemoryRelayClient {
  search(query: string, limit: number, threshold: number, opts?: {
    scope?: "session" | "long-term";
    session_id?: string;
    namespace?: string;
  }): Promise<Array<{ memory: Memory; score: number }>>;
  store(content: string, metadata?: Record<string, string>, opts?: Record<string, unknown>): Promise<Memory>;
  list(limit?: number, offset?: number): Promise<Memory[]>;
  getOrCreateSession(
    externalId: string,
    agentId?: string,
    title?: string,
    project?: string,
    metadata?: Record<string, string>,
  ): Promise<{ id: string }>;
  endSession(sessionId: string, summary?: string): Promise<void>;
}

export interface PipelineContext {
  readonly requestCtx: RequestContext;
  readonly config: PluginConfig;
  readonly client: MemoryRelayClient;
}

// --- Recall types ---

export interface RecallInput {
  prompt: string;
  memories: Memory[];
  scope: "session" | "long-term" | "all";
  resolvedSessionKey?: string;
  longTerm?: ScoredMemory[];
  session?: ScoredMemory[];
  formatted?: string;
}

export type RecallResult =
  | { action: "continue"; data: RecallInput }
  | { action: "skip" };

export interface RecallStage {
  name: string;
  enabled: (ctx: PipelineContext) => boolean;
  execute: (input: RecallInput, ctx: PipelineContext) => Promise<RecallResult>;
}

// --- Capture types ---

export interface CaptureInput {
  messages: ConversationMessage[];
}

export type CaptureResult =
  | { action: "continue"; data: CaptureInput }
  | { action: "skip" };

export interface CaptureStage {
  name: string;
  enabled: (ctx: PipelineContext) => boolean;
  execute: (input: CaptureInput, ctx: PipelineContext) => Promise<CaptureResult>;
}
```

- [ ] **Step 4: Write pipeline runner**

```typescript
// src/pipelines/runner.ts

import type { PipelineContext } from "./types.js";

interface Stage<TInput> {
  name: string;
  enabled: (ctx: PipelineContext) => boolean;
  execute: (input: TInput, ctx: PipelineContext) => Promise<
    | { action: "continue"; data: TInput }
    | { action: "skip" }
  >;
}

export async function runPipeline<TInput>(
  stages: Stage<TInput>[],
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

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/pipelines/runner.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 6: Commit**

```bash
git add src/pipelines/types.ts src/pipelines/runner.ts tests/pipelines/runner.test.ts
git commit -m "feat: add pipeline types and generic runner (v0.16)"
```

---

## Task 2: Shared Filters — Non-Interactive Detection

**Files:**
- Create: `src/filters/non-interactive.ts`
- Test: `tests/filters/non-interactive.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/filters/non-interactive.test.ts
import { describe, test, expect } from "vitest";
import { isNonInteractive, type TriggerSignals } from "../../src/filters/non-interactive.js";

function signals(overrides: Partial<TriggerSignals> = {}): TriggerSignals {
  return {
    trigger: null,
    sessionKey: "agent:main:abc123",
    prompt: "How do I configure the database?",
    ...overrides,
  };
}

describe("isNonInteractive", () => {
  test("returns false for normal interactive prompt", () => {
    expect(isNonInteractive(signals())).toBe(false);
  });

  test("returns true for cron trigger", () => {
    expect(isNonInteractive(signals({ trigger: "cron" }))).toBe(true);
  });

  test("returns true for heartbeat trigger", () => {
    expect(isNonInteractive(signals({ trigger: "heartbeat" }))).toBe(true);
  });

  test("returns true for schedule trigger", () => {
    expect(isNonInteractive(signals({ trigger: "schedule" }))).toBe(true);
  });

  test("returns true for automation trigger", () => {
    expect(isNonInteractive(signals({ trigger: "automation" }))).toBe(true);
  });

  test("returns true for health_check trigger", () => {
    expect(isNonInteractive(signals({ trigger: "health_check" }))).toBe(true);
  });

  test("returns true for session key with :cron: pattern", () => {
    expect(isNonInteractive(signals({ sessionKey: "agent:main:cron:daily" }))).toBe(true);
  });

  test("returns true for session key with :heartbeat: pattern", () => {
    expect(isNonInteractive(signals({ sessionKey: "system:heartbeat:check" }))).toBe(true);
  });

  test("returns true for session key with :schedule: pattern", () => {
    expect(isNonInteractive(signals({ sessionKey: "agent:main:schedule:nightly" }))).toBe(true);
  });

  test("returns true for session key with :automation: pattern", () => {
    expect(isNonInteractive(signals({ sessionKey: "ci:automation:deploy" }))).toBe(true);
  });

  test("returns true for empty prompt", () => {
    expect(isNonInteractive(signals({ prompt: "" }))).toBe(true);
  });

  test("returns true for very short prompt (< 5 chars)", () => {
    expect(isNonInteractive(signals({ prompt: "hi" }))).toBe(true);
  });

  test("returns true for HEARTBEAT_OK prompt", () => {
    expect(isNonInteractive(signals({ prompt: "HEARTBEAT_OK" }))).toBe(true);
  });

  test("returns true for NO_REPLY prompt", () => {
    expect(isNonInteractive(signals({ prompt: "NO_REPLY" }))).toBe(true);
  });

  test("returns true for HEALTH_CHECK prompt", () => {
    expect(isNonInteractive(signals({ prompt: "HEALTH_CHECK" }))).toBe(true);
  });

  test("returns true for PING prompt", () => {
    expect(isNonInteractive(signals({ prompt: "PING" }))).toBe(true);
  });

  test("returns false for short but valid prompt (>= 5 chars)", () => {
    expect(isNonInteractive(signals({ prompt: "help?" }))).toBe(false);
  });

  test("returns false for unknown trigger type", () => {
    expect(isNonInteractive(signals({ trigger: "user_message" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/filters/non-interactive.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// src/filters/non-interactive.ts

export interface TriggerSignals {
  trigger: string | null;
  sessionKey: string;
  prompt: string;
}

const NON_INTERACTIVE_TRIGGERS = new Set([
  "cron", "heartbeat", "schedule", "automation", "health_check",
]);

const NON_INTERACTIVE_SESSION_PATTERNS = [
  /:cron:/,
  /:heartbeat:/,
  /:schedule:/,
  /:automation:/,
];

const EMPTY_PROMPTS = new Set([
  "HEARTBEAT_OK", "NO_REPLY", "HEALTH_CHECK", "PING",
]);

export function isNonInteractive(signals: TriggerSignals): boolean {
  if (signals.trigger && NON_INTERACTIVE_TRIGGERS.has(signals.trigger)) return true;
  if (NON_INTERACTIVE_SESSION_PATTERNS.some(p => p.test(signals.sessionKey))) return true;
  if (!signals.prompt || signals.prompt.length < 5) return true;
  if (EMPTY_PROMPTS.has(signals.prompt)) return true;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/filters/non-interactive.test.ts`
Expected: PASS — all 18 tests green

- [ ] **Step 5: Commit**

```bash
git add src/filters/non-interactive.ts tests/filters/non-interactive.test.ts
git commit -m "feat: add non-interactive trigger detection filter"
```

---

## Task 3: Shared Filters — Noise Patterns

**Files:**
- Create: `src/filters/noise-patterns.ts`
- Test: `tests/filters/noise-patterns.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/filters/noise-patterns.test.ts
import { describe, test, expect } from "vitest";
import { shouldDropMessage, isAssistantBoilerplate } from "../../src/filters/noise-patterns.js";
import type { ConversationMessage } from "../../src/pipelines/types.js";

function msg(role: "user" | "assistant", content: string): ConversationMessage {
  return { role, content };
}

describe("shouldDropMessage", () => {
  test("drops messages shorter than 10 chars", () => {
    expect(shouldDropMessage(msg("user", "ok"))).toBe(true);
    expect(shouldDropMessage(msg("user", "short"))).toBe(true);
  });

  test("drops HEARTBEAT_OK", () => {
    expect(shouldDropMessage(msg("user", "HEARTBEAT_OK"))).toBe(true);
  });

  test("drops NO_REPLY", () => {
    expect(shouldDropMessage(msg("user", "NO_REPLY"))).toBe(true);
  });

  test("drops bare timestamps", () => {
    expect(shouldDropMessage(msg("user", "2026-03-28T14:30:00Z"))).toBe(true);
  });

  test("drops single-word acks", () => {
    const acks = ["ok", "sure", "done", "yes", "no", "thanks", "got it", "yep", "nope", "k", "ty", "thx", "cool", "perfect"];
    for (const ack of acks) {
      expect(shouldDropMessage(msg("user", ack))).toBe(true);
    }
  });

  test("drops acks with trailing period", () => {
    expect(shouldDropMessage(msg("user", "ok."))).toBe(true);
    expect(shouldDropMessage(msg("user", "sure."))).toBe(true);
  });

  test("drops system-reminder blocks", () => {
    expect(shouldDropMessage(msg("system", "<system-reminder>some content</system-reminder>"))).toBe(true);
  });

  test("drops bare tool calls", () => {
    expect(shouldDropMessage(msg("assistant", "<tool_call>\n{\"name\":\"read\"}\n</tool_call>"))).toBe(true);
  });

  test("drops compaction audit logs", () => {
    expect(shouldDropMessage(msg("system", "<compaction-audit>removed 50 messages</compaction-audit>"))).toBe(true);
  });

  test("keeps normal user messages", () => {
    expect(shouldDropMessage(msg("user", "How do I configure the database connection?"))).toBe(false);
  });

  test("keeps normal assistant messages", () => {
    expect(shouldDropMessage(msg("assistant", "You can configure the database by editing the .env file with your connection string."))).toBe(false);
  });

  test("drops empty content", () => {
    expect(shouldDropMessage(msg("user", ""))).toBe(true);
  });

  test("drops whitespace-only content", () => {
    expect(shouldDropMessage(msg("user", "   \n  "))).toBe(true);
  });
});

describe("isAssistantBoilerplate", () => {
  test("returns false for user messages", () => {
    expect(isAssistantBoilerplate(msg("user", "I see what you mean"))).toBe(false);
  });

  test("returns false for long assistant messages (> 300 chars)", () => {
    const longMsg = "I see what you're asking about. " + "x".repeat(300);
    expect(isAssistantBoilerplate(msg("assistant", longMsg))).toBe(false);
  });

  test("detects short boilerplate with high signal density", () => {
    expect(isAssistantBoilerplate(msg("assistant", "I see. Let me know if you need anything else."))).toBe(true);
  });

  test("detects 'how can I help' boilerplate", () => {
    expect(isAssistantBoilerplate(msg("assistant", "Sure! How can I help you with that?"))).toBe(true);
  });

  test("detects 'happy to help' boilerplate", () => {
    expect(isAssistantBoilerplate(msg("assistant", "I'm happy to help! Is there anything else?"))).toBe(true);
  });

  test("keeps short assistant messages with real content", () => {
    expect(isAssistantBoilerplate(msg("assistant", "The config file is at /etc/app/config.yaml"))).toBe(false);
  });

  test("keeps medium assistant messages even with one signal", () => {
    expect(isAssistantBoilerplate(msg("assistant", "Sure, the database connection pool size should be set to 20 for your workload. Edit the DATABASE_POOL_SIZE env var in your .env file."))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/filters/noise-patterns.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// src/filters/noise-patterns.ts

import type { ConversationMessage } from "../pipelines/types.js";

const DROP_PATTERNS = {
  systemTriggers: /^(HEARTBEAT_OK|NO_REPLY|HEALTH_CHECK|PING)$/,
  timestamps: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  acks: /^(ok|okay|sure|done|yes|no|thanks|thank you|got it|right|yep|nope|k|ty|thx|np|ack|fine|cool|great|perfect)\.?$/i,
  routingBlocks: /^<(?:system-reminder|routing|metadata|tool-result)>/,
  bareToolCalls: /^<tool_call>[\s\S]*<\/tool_call>$/,
  compactionLogs: /^<compaction-audit>/,
};

export function shouldDropMessage(message: ConversationMessage): boolean {
  const text = message.content.trim();
  if (text.length < 10) return true;
  return Object.values(DROP_PATTERNS).some(p => p.test(text));
}

const BOILERPLATE_SIGNALS = [
  /^(I see|I understand|Got it|Sure|Let me|I'll|I can|Here's what)/i,
  /how can I help/i,
  /let me know if/i,
  /is there anything else/i,
  /happy to help/i,
];

export function isAssistantBoilerplate(message: ConversationMessage): boolean {
  if (message.role !== "assistant") return false;
  const text = message.content.trim();
  if (text.length > 300) return false;
  const signalCount = BOILERPLATE_SIGNALS.filter(p => p.test(text)).length;
  const density = signalCount / (text.length / 100);
  return density > 0.5;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/filters/noise-patterns.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/filters/noise-patterns.ts tests/filters/noise-patterns.test.ts
git commit -m "feat: add noise pattern filters for message-level and boilerplate detection"
```

---

## Task 4: Shared Filters — Content Patterns

**Files:**
- Create: `src/filters/content-patterns.ts`
- Test: `tests/filters/content-patterns.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/filters/content-patterns.test.ts
import { describe, test, expect } from "vitest";
import { stripContent, LONG_TERM_SIGNALS, resolveScope } from "../../src/filters/content-patterns.js";

describe("stripContent", () => {
  test("removes memoryrelay-workflow blocks", () => {
    const input = "Before <memoryrelay-workflow>instructions here</memoryrelay-workflow> After";
    expect(stripContent(input)).toBe("Before  After");
  });

  test("removes relevant-memories blocks", () => {
    const input = "Text <relevant-memories>\n- memory 1\n- memory 2\n</relevant-memories> more text";
    expect(stripContent(input)).toBe("Text  more text");
  });

  test("removes compaction-summary blocks", () => {
    const input = "Before <compaction-summary>removed 50 messages</compaction-summary> After";
    expect(stripContent(input)).toBe("Before  After");
  });

  test("removes system-reminder blocks", () => {
    const input = "Text <system-reminder>system info</system-reminder> more";
    expect(stripContent(input)).toBe("Text  more");
  });

  test("removes media/attachment references", () => {
    const input = "Look at [image: screenshot.png] for details";
    expect(stripContent(input)).toBe("Look at  for details");
  });

  test("removes large code blocks (> 500 chars)", () => {
    const code = "x".repeat(600);
    const input = `Before\n\`\`\`typescript\n${code}\n\`\`\`\nAfter`;
    const result = stripContent(input);
    expect(result).not.toContain(code);
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });

  test("keeps small code blocks (< 500 chars)", () => {
    const input = "Before\n```typescript\nconst x = 1;\n```\nAfter";
    expect(stripContent(input)).toContain("const x = 1;");
  });

  test("collapses excessive whitespace", () => {
    const input = "Line 1\n\n\n\n\nLine 2";
    expect(stripContent(input)).toBe("Line 1\n\nLine 2");
  });

  test("returns content unchanged when nothing to strip", () => {
    const input = "This is a normal message with no special blocks.";
    expect(stripContent(input)).toBe(input);
  });
});

describe("resolveScope", () => {
  test("returns long-term for preference signals", () => {
    expect(resolveScope("I always prefer dark mode")).toBe("long-term");
    expect(resolveScope("I never use tabs")).toBe("long-term");
    expect(resolveScope("My name is Alice")).toBe("long-term");
  });

  test("returns long-term for remember/important signals", () => {
    expect(resolveScope("Remember that the API key rotates monthly")).toBe("long-term");
    expect(resolveScope("Important: the deploy requires manual approval")).toBe("long-term");
  });

  test("returns long-term for technical config signals", () => {
    expect(resolveScope("The API endpoint is https://api.example.com")).toBe("long-term");
    expect(resolveScope("Server config uses port 8080")).toBe("long-term");
  });

  test("returns long-term for decision signals", () => {
    expect(resolveScope("We decided to use PostgreSQL")).toBe("long-term");
    expect(resolveScope("The team approved the new architecture")).toBe("long-term");
  });

  test("returns long-term for pattern/convention signals", () => {
    expect(resolveScope("Our coding convention is to use camelCase")).toBe("long-term");
    expect(resolveScope("The standard is to run tests before merge")).toBe("long-term");
  });

  test("returns session for general conversation", () => {
    expect(resolveScope("Can you help me fix this bug?")).toBe("session");
    expect(resolveScope("The error is on line 42")).toBe("session");
    expect(resolveScope("Let me check the logs")).toBe("session");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/filters/content-patterns.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// src/filters/content-patterns.ts

const STRIP_PATTERNS = [
  { pattern: /<memoryrelay-workflow>[\s\S]*?<\/memoryrelay-workflow>/g, name: "workflow-blocks" },
  { pattern: /<relevant-memories>[\s\S]*?<\/relevant-memories>/g, name: "recall-blocks" },
  { pattern: /<compaction-summary>[\s\S]*?<\/compaction-summary>/g, name: "compaction-blocks" },
  { pattern: /<system-reminder>[\s\S]*?<\/system-reminder>/g, name: "system-reminders" },
  { pattern: /\[(?:image|file|attachment):.*?\]/g, name: "media-refs" },
  { pattern: /```[\s\S]{500,}?```/g, name: "large-code-blocks" },
];

export function stripContent(content: string): string {
  let result = content;
  for (const { pattern } of STRIP_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, "");
  }
  result = result.replace(/\n{3,}/g, "\n\n").trim();
  return result;
}

export const LONG_TERM_SIGNALS = [
  /(?:always|never|prefer|don't like|my name is|i work at)/i,
  /(?:remember|important|note that|keep in mind)/i,
  /(?:api key|endpoint|server|credentials|config)/i,
  /(?:decision|chose|decided|agreed|approved)/i,
  /(?:pattern|convention|standard|rule)/i,
];

export function resolveScope(content: string): "session" | "long-term" {
  if (LONG_TERM_SIGNALS.some(p => p.test(content))) return "long-term";
  return "session";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/filters/content-patterns.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/filters/content-patterns.ts tests/filters/content-patterns.test.ts
git commit -m "feat: add content stripping patterns and scope resolution"
```

---

## Task 5: Context Layer — Request Context & Namespace Router

**Files:**
- Create: `src/context/request-context.ts`
- Create: `src/context/namespace-router.ts`
- Test: `tests/context/request-context.test.ts`
- Test: `tests/context/namespace-router.test.ts`

- [ ] **Step 1: Write namespace router test**

```typescript
// tests/context/namespace-router.test.ts
import { describe, test, expect } from "vitest";
import { resolveNamespace, type NamespaceConfig } from "../../src/context/namespace-router.js";

describe("resolveNamespace", () => {
  test("returns 'default' when isolateAgents is false", () => {
    expect(resolveNamespace("agent-1", { isolateAgents: false, subagentPolicy: "inherit" })).toBe("default");
  });

  test("returns 'default' when agentId is null", () => {
    expect(resolveNamespace(null, { isolateAgents: true, subagentPolicy: "inherit" })).toBe("default");
  });

  test("returns agent namespace when isolateAgents is true and agentId set", () => {
    expect(resolveNamespace("agent-1", { isolateAgents: true, subagentPolicy: "inherit" })).toBe("agent:agent-1");
  });

  test("uses defaults when config is undefined", () => {
    expect(resolveNamespace("agent-1", undefined)).toBe("default");
  });
});
```

- [ ] **Step 2: Write request context test**

```typescript
// tests/context/request-context.test.ts
import { describe, test, expect } from "vitest";
import { buildRequestContext } from "../../src/context/request-context.js";
import type { PluginConfig } from "../../src/pipelines/types.js";

const baseConfig: PluginConfig = { agentId: "fallback-agent" };

describe("buildRequestContext", () => {
  test("builds context from event with sessionKey", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc123" }, prompt: "  Hello world  " },
      baseConfig,
    );
    expect(ctx.sessionKey).toBe("agent:main:abc123");
    expect(ctx.prompt).toBe("Hello world");
    expect(ctx.isSubagent).toBe(false);
    expect(ctx.parentSessionKey).toBeNull();
    expect(ctx.agentId).toBe("main");
  });

  test("detects subagent from session key pattern", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:subagent:task-uuid-123" }, prompt: "test" },
      baseConfig,
    );
    expect(ctx.isSubagent).toBe(true);
    expect(ctx.agentId).toBe("main");
    expect(ctx.parentSessionKey).toBe("agent:main:task-uuid-123");
  });

  test("falls back to config agentId when no agent in session key", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "simple-session-123" }, prompt: "test" },
      baseConfig,
    );
    expect(ctx.agentId).toBe("fallback-agent");
    expect(ctx.isSubagent).toBe(false);
  });

  test("falls back to sessionId when no ctx.sessionKey", () => {
    const ctx = buildRequestContext(
      { sessionId: "legacy-session", prompt: "test" },
      baseConfig,
    );
    expect(ctx.sessionKey).toBe("legacy-session");
  });

  test("extracts channel from event", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "s1" }, channel: "telegram-123", prompt: "test" },
      baseConfig,
    );
    expect(ctx.channel).toBe("telegram-123");
  });

  test("extracts trigger from event ctx", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "s1", trigger: "cron" }, prompt: "HEARTBEAT_OK" },
      baseConfig,
    );
    expect(ctx.trigger).toBe("cron");
  });

  test("context is frozen (immutable)", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "s1" }, prompt: "test" },
      baseConfig,
    );
    expect(() => { (ctx as any).sessionKey = "hacked"; }).toThrow();
  });

  test("handles missing prompt gracefully", () => {
    const ctx = buildRequestContext(
      { ctx: { sessionKey: "s1" } },
      baseConfig,
    );
    expect(ctx.prompt).toBe("");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/context/`
Expected: FAIL — modules don't exist

- [ ] **Step 4: Write namespace router**

```typescript
// src/context/namespace-router.ts

export interface NamespaceConfig {
  isolateAgents?: boolean;
  subagentPolicy?: "inherit" | "isolate" | "skip";
}

const DEFAULTS: Required<NamespaceConfig> = {
  isolateAgents: false,
  subagentPolicy: "inherit",
};

export function resolveNamespace(
  agentId: string | null,
  nsConfig: NamespaceConfig | undefined,
): string {
  const config = { ...DEFAULTS, ...nsConfig };
  if (!config.isolateAgents || !agentId) return "default";
  return `agent:${agentId}`;
}
```

- [ ] **Step 5: Write request context builder**

```typescript
// src/context/request-context.ts

import type { RequestContext, PluginConfig } from "../pipelines/types.js";
import { resolveNamespace } from "./namespace-router.js";

export interface HookEvent {
  ctx?: {
    sessionKey?: string;
    trigger?: string;
  };
  sessionId?: string;
  channel?: string | number;
  prompt?: string;
}

export function buildRequestContext(event: HookEvent, config: PluginConfig): RequestContext {
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
    channel: event.channel != null ? String(event.channel) : null,
    trigger: event.ctx?.trigger ?? null,
    prompt: event.prompt?.trim() ?? "",
    isSubagent,
    parentSessionKey,
    namespace: resolveNamespace(agentId, config.namespace),
    timestamp: Date.now(),
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/context/`
Expected: PASS — all tests green

- [ ] **Step 7: Commit**

```bash
git add src/context/request-context.ts src/context/namespace-router.ts tests/context/request-context.test.ts tests/context/namespace-router.test.ts
git commit -m "feat: add request context builder and namespace router"
```

---

## Task 6: Context Layer — Session Resolver

**Files:**
- Create: `src/context/session-resolver.ts`
- Test: `tests/context/session-resolver.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/context/session-resolver.test.ts
import { describe, test, expect, vi, beforeEach } from "vitest";
import { SessionResolver } from "../../src/context/session-resolver.js";
import type { MemoryRelayClient, PluginConfig, RequestContext } from "../../src/pipelines/types.js";

function mockClient(): MemoryRelayClient {
  let nextId = 1;
  return {
    search: vi.fn(),
    store: vi.fn(),
    list: vi.fn(),
    getOrCreateSession: vi.fn(async () => ({ id: `session-${nextId++}` })),
    endSession: vi.fn(async () => {}),
  };
}

function requestCtx(sessionKey: string): RequestContext {
  return {
    sessionKey,
    agentId: "test-agent",
    channel: null,
    trigger: null,
    prompt: "test",
    isSubagent: false,
    parentSessionKey: null,
    namespace: "default",
    timestamp: Date.now(),
  };
}

const config: PluginConfig = { sessionTimeoutMinutes: 120 };

describe("SessionResolver", () => {
  test("creates session on first resolve", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    const entry = await resolver.resolve(requestCtx("key-1"));
    expect(entry.sessionId).toBe("session-1");
    expect(client.getOrCreateSession).toHaveBeenCalledTimes(1);
  });

  test("returns cached session on second resolve", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    await resolver.resolve(requestCtx("key-1"));
    await resolver.resolve(requestCtx("key-1"));
    expect(client.getOrCreateSession).toHaveBeenCalledTimes(1);
  });

  test("creates separate sessions for different keys", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    const entry1 = await resolver.resolve(requestCtx("key-1"));
    const entry2 = await resolver.resolve(requestCtx("key-2"));
    expect(entry1.sessionId).toBe("session-1");
    expect(entry2.sessionId).toBe("session-2");
    expect(client.getOrCreateSession).toHaveBeenCalledTimes(2);
  });

  test("deduplicates concurrent creates for same key", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    const ctx = requestCtx("key-1");
    const [entry1, entry2] = await Promise.all([
      resolver.resolve(ctx),
      resolver.resolve(ctx),
    ]);
    expect(entry1.sessionId).toBe(entry2.sessionId);
    expect(client.getOrCreateSession).toHaveBeenCalledTimes(1);
  });

  test("endSession removes from cache and calls client", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    await resolver.resolve(requestCtx("key-1"));
    await resolver.endSession("key-1");
    expect(client.endSession).toHaveBeenCalledWith("session-1", undefined);
    // Next resolve should create a new session
    const entry = await resolver.resolve(requestCtx("key-1"));
    expect(entry.sessionId).toBe("session-2");
  });

  test("endSession is no-op for unknown key", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    await resolver.endSession("unknown");
    expect(client.endSession).not.toHaveBeenCalled();
  });

  test("cleanupStale removes stale entries", async () => {
    const client = mockClient();
    // 1ms timeout for test
    const shortConfig: PluginConfig = { sessionTimeoutMinutes: 0 };
    const resolver = new SessionResolver(client, shortConfig);
    await resolver.resolve(requestCtx("key-1"));
    // Wait a tick for staleness
    await new Promise(r => setTimeout(r, 10));
    await resolver.cleanupStale();
    expect(client.endSession).toHaveBeenCalledWith("session-1", undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/context/session-resolver.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// src/context/session-resolver.ts

import type { MemoryRelayClient, PluginConfig, RequestContext } from "../pipelines/types.js";

export interface SessionEntry {
  readonly sessionId: string;
  readonly externalId: string;
  readonly createdAt: number;
  lastActivityAt: number;
}

export class SessionResolver {
  private readonly cache = new Map<string, SessionEntry>();
  private readonly pending = new Map<string, Promise<SessionEntry>>();
  private readonly client: MemoryRelayClient;
  private readonly timeoutMs: number;

  constructor(client: MemoryRelayClient, config: PluginConfig) {
    this.client = client;
    this.timeoutMs = (config.sessionTimeoutMinutes ?? 120) * 60_000;
  }

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

  private async createSession(ctx: RequestContext): Promise<SessionEntry> {
    const result = await this.client.getOrCreateSession(
      ctx.sessionKey,
      ctx.agentId ?? undefined,
      undefined,
      undefined,
      { namespace: ctx.namespace },
    );
    return {
      sessionId: result.id,
      externalId: ctx.sessionKey,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  private isStale(entry: SessionEntry): boolean {
    return (Date.now() - entry.lastActivityAt) > this.timeoutMs;
  }

  async endSession(key: string, summary?: string): Promise<void> {
    const entry = this.cache.get(key);
    if (entry) {
      await this.client.endSession(entry.sessionId, summary);
      this.cache.delete(key);
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/context/session-resolver.test.ts`
Expected: PASS — all 7 tests green

- [ ] **Step 5: Commit**

```bash
git add src/context/session-resolver.ts tests/context/session-resolver.test.ts
git commit -m "feat: add concurrency-safe session resolver with stale cleanup"
```

---

## Task 7: Recall Pipeline — All 5 Stages

**Files:**
- Create: `src/pipelines/recall/trigger-gate.ts`
- Create: `src/pipelines/recall/scope-resolver.ts`
- Create: `src/pipelines/recall/search.ts`
- Create: `src/pipelines/recall/rank.ts`
- Create: `src/pipelines/recall/format.ts`
- Create: `src/pipelines/recall/index.ts`
- Test: `tests/pipelines/recall/trigger-gate.test.ts`
- Test: `tests/pipelines/recall/scope-resolver.test.ts`
- Test: `tests/pipelines/recall/rank.test.ts`
- Test: `tests/pipelines/recall/format.test.ts`

- [ ] **Step 1: Write recall trigger gate test**

```typescript
// tests/pipelines/recall/trigger-gate.test.ts
import { describe, test, expect } from "vitest";
import { recallTriggerGate } from "../../../src/pipelines/recall/trigger-gate.js";
import type { PipelineContext, RecallInput } from "../../../src/pipelines/types.js";

function ctx(overrides: Partial<PipelineContext["requestCtx"]> = {}): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "agent:main:abc",
      agentId: "main",
      channel: null,
      trigger: null,
      prompt: "How do I configure the database?",
      isSubagent: false,
      parentSessionKey: null,
      namespace: "default",
      timestamp: Date.now(),
      ...overrides,
    },
    config: { autoRecall: true } as any,
    client: {} as any,
  };
}

const input: RecallInput = { prompt: "test", memories: [], scope: "all" };

describe("recallTriggerGate", () => {
  test("is always enabled", () => {
    expect(recallTriggerGate.enabled(ctx())).toBe(true);
  });

  test("continues for interactive prompts", async () => {
    const result = await recallTriggerGate.execute(input, ctx());
    expect(result.action).toBe("continue");
  });

  test("skips for cron trigger", async () => {
    const result = await recallTriggerGate.execute(input, ctx({ trigger: "cron" }));
    expect(result.action).toBe("skip");
  });

  test("skips for HEARTBEAT_OK prompt", async () => {
    const result = await recallTriggerGate.execute(input, ctx({ prompt: "HEARTBEAT_OK" }));
    expect(result.action).toBe("skip");
  });

  test("skips for very short prompt", async () => {
    const result = await recallTriggerGate.execute(input, ctx({ prompt: "hi" }));
    expect(result.action).toBe("skip");
  });
});
```

- [ ] **Step 2: Write scope resolver test**

```typescript
// tests/pipelines/recall/scope-resolver.test.ts
import { describe, test, expect } from "vitest";
import { recallScopeResolver } from "../../../src/pipelines/recall/scope-resolver.js";
import type { PipelineContext, RecallInput } from "../../../src/pipelines/types.js";

function ctx(overrides: Partial<PipelineContext["requestCtx"]> = {}, configOverrides: any = {}): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "agent:main:abc",
      agentId: "main",
      channel: null,
      trigger: null,
      prompt: "test",
      isSubagent: false,
      parentSessionKey: null,
      namespace: "default",
      timestamp: Date.now(),
      ...overrides,
    },
    config: { namespace: { subagentPolicy: "inherit" }, ...configOverrides } as any,
    client: {} as any,
  };
}

const input: RecallInput = { prompt: "test", memories: [], scope: "all" };

describe("recallScopeResolver", () => {
  test("passes through for normal agent", async () => {
    const result = await recallScopeResolver.execute(input, ctx());
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.resolvedSessionKey).toBe("agent:main:abc");
    }
  });

  test("routes subagent to parent session key when policy is inherit", async () => {
    const result = await recallScopeResolver.execute(input, ctx({
      isSubagent: true,
      parentSessionKey: "agent:main:task-123",
      sessionKey: "agent:main:subagent:task-123",
    }));
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.resolvedSessionKey).toBe("agent:main:task-123");
    }
  });

  test("skips for subagent when policy is skip", async () => {
    const result = await recallScopeResolver.execute(input, ctx(
      { isSubagent: true },
      { namespace: { subagentPolicy: "skip" } },
    ));
    expect(result.action).toBe("skip");
  });

  test("uses own session key for subagent when policy is isolate", async () => {
    const result = await recallScopeResolver.execute(input, ctx(
      { isSubagent: true, sessionKey: "agent:main:subagent:xyz", parentSessionKey: "agent:main:xyz" },
      { namespace: { subagentPolicy: "isolate" } },
    ));
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.resolvedSessionKey).toBe("agent:main:subagent:xyz");
    }
  });
});
```

- [ ] **Step 3: Write rank stage test**

```typescript
// tests/pipelines/recall/rank.test.ts
import { describe, test, expect } from "vitest";
import { scoreMemory } from "../../../src/pipelines/recall/rank.js";
import type { Memory } from "../../../src/pipelines/types.js";

function mem(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1",
    content: "test",
    agent_id: "agent",
    user_id: "user",
    metadata: {},
    entities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("scoreMemory", () => {
  test("base score equals similarity", () => {
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString(); // 2 days ago
    const score = scoreMemory(mem({ created_at: oldDate }), 0.7, {});
    // No freshness boost (> 24h), no importance, no tier
    expect(score).toBeCloseTo(0.7, 1);
  });

  test("adds freshness boost for recent memories", () => {
    const recentDate = new Date(Date.now() - 1 * 3600 * 1000).toISOString(); // 1 hour ago
    const score = scoreMemory(mem({ created_at: recentDate }), 0.7, {});
    // Freshness boost: ~0.1 * (1 - 1/24) ≈ 0.096
    expect(score).toBeGreaterThan(0.79);
  });

  test("adds importance boost", () => {
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const score = scoreMemory(mem({ created_at: oldDate, importance: 1.0 }), 0.7, {});
    // Importance boost: 0.1 * 1.0 = 0.1
    expect(score).toBeCloseTo(0.8, 1);
  });

  test("adds tier boost for hot", () => {
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const score = scoreMemory(mem({ created_at: oldDate, tier: "hot" }), 0.7, {});
    expect(score).toBeCloseTo(0.75, 1);
  });

  test("caps at 1.0", () => {
    const recentDate = new Date(Date.now() - 1000).toISOString();
    const score = scoreMemory(mem({ created_at: recentDate, importance: 1.0, tier: "hot" }), 0.95, {});
    expect(score).toBeLessThanOrEqual(1.0);
  });

  test("respects disabled boosts via config", () => {
    const recentDate = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    const score = scoreMemory(mem({ created_at: recentDate, importance: 1.0, tier: "hot" }), 0.7, {
      freshnessBoost: false,
      importanceBoost: false,
      tierBoost: false,
    });
    expect(score).toBeCloseTo(0.7, 1);
  });
});
```

- [ ] **Step 4: Write format stage test**

```typescript
// tests/pipelines/recall/format.test.ts
import { describe, test, expect } from "vitest";
import { formatMemories } from "../../../src/pipelines/recall/format.js";
import type { Memory } from "../../../src/pipelines/types.js";

function mem(content: string): Memory {
  return {
    id: "m1", content, agent_id: "a", user_id: "u",
    metadata: {}, entities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("formatMemories", () => {
  test("formats long-term only", () => {
    const result = formatMemories([mem("fact A"), mem("fact B")], [], false);
    expect(result).toContain("<long-term-memories>");
    expect(result).toContain("- fact A");
    expect(result).toContain("- fact B");
    expect(result).not.toContain("<session-memories>");
  });

  test("formats session only", () => {
    const result = formatMemories([], [mem("ctx item")], false);
    expect(result).toContain("<session-memories>");
    expect(result).toContain("- ctx item");
    expect(result).not.toContain("<long-term-memories>");
  });

  test("formats both scopes", () => {
    const result = formatMemories([mem("long")], [mem("short")], false);
    expect(result).toContain("<long-term-memories>");
    expect(result).toContain("<session-memories>");
  });

  test("prepends subagent notice", () => {
    const result = formatMemories([mem("fact")], [], true);
    expect(result).toContain("parent session");
    expect(result).toContain("context only");
  });

  test("returns empty string when no memories", () => {
    expect(formatMemories([], [], false)).toBe("");
  });
});
```

- [ ] **Step 5: Run all recall tests to verify they fail**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/pipelines/recall/`
Expected: FAIL — modules don't exist

- [ ] **Step 6: Write recall trigger gate**

```typescript
// src/pipelines/recall/trigger-gate.ts

import type { RecallStage } from "../types.js";
import { isNonInteractive } from "../../filters/non-interactive.js";

export const recallTriggerGate: RecallStage = {
  name: "trigger-gate",
  enabled: () => true,
  execute: async (input, ctx) => {
    if (isNonInteractive({
      trigger: ctx.requestCtx.trigger,
      sessionKey: ctx.requestCtx.sessionKey,
      prompt: ctx.requestCtx.prompt,
    })) {
      return { action: "skip" };
    }
    return { action: "continue", data: input };
  },
};
```

- [ ] **Step 7: Write recall scope resolver**

```typescript
// src/pipelines/recall/scope-resolver.ts

import type { RecallStage } from "../types.js";

export const recallScopeResolver: RecallStage = {
  name: "scope-resolver",
  enabled: () => true,
  execute: async (input, ctx) => {
    const { isSubagent, parentSessionKey, sessionKey } = ctx.requestCtx;
    const policy = ctx.config.namespace?.subagentPolicy ?? "inherit";

    if (isSubagent && policy === "skip") {
      return { action: "skip" };
    }

    const resolvedSessionKey = (isSubagent && policy === "inherit")
      ? parentSessionKey ?? sessionKey
      : sessionKey;

    return {
      action: "continue",
      data: { ...input, resolvedSessionKey },
    };
  },
};
```

- [ ] **Step 8: Write recall search stage**

```typescript
// src/pipelines/recall/search.ts

import type { RecallStage } from "../types.js";

export const recallSearch: RecallStage = {
  name: "search",
  enabled: (ctx) => !!ctx.config.autoRecall,
  execute: async (input, ctx) => {
    const { client } = ctx;
    const { namespace } = ctx.requestCtx;
    const resolvedSessionKey = input.resolvedSessionKey ?? ctx.requestCtx.sessionKey;
    const limit = ctx.config.recallLimit ?? 5;
    const threshold = ctx.config.recallThreshold ?? 0.3;

    const [longTerm, session] = await Promise.all([
      client.search(input.prompt, limit, threshold, {
        scope: "long-term",
        namespace,
      }),
      client.search(input.prompt, limit, threshold, {
        scope: "session",
        session_id: resolvedSessionKey,
        namespace,
      }),
    ]);

    return {
      action: "continue",
      data: {
        ...input,
        longTerm: longTerm.map(r => ({ memory: r.memory, finalScore: r.score })),
        session: session.map(r => ({ memory: r.memory, finalScore: r.score })),
      },
    };
  },
};
```

- [ ] **Step 9: Write recall rank stage**

```typescript
// src/pipelines/recall/rank.ts

import type { RecallStage, Memory } from "../types.js";

interface RankingConfig {
  freshnessBoost?: boolean;
  freshnessWindowHours?: number;
  importanceBoost?: boolean;
  tierBoost?: boolean;
}

export function scoreMemory(
  memory: Memory,
  similarity: number,
  rankingConfig: RankingConfig,
): number {
  let score = similarity;

  if (rankingConfig.freshnessBoost !== false) {
    const windowHours = rankingConfig.freshnessWindowHours ?? 24;
    const ageHours = (Date.now() - new Date(memory.created_at).getTime()) / 3_600_000;
    if (ageHours < windowHours) {
      score += 0.1 * (1 - ageHours / windowHours);
    }
  }

  if (rankingConfig.importanceBoost !== false && memory.importance != null) {
    score += 0.1 * memory.importance;
  }

  if (rankingConfig.tierBoost !== false && memory.tier === "hot") {
    score += 0.05;
  }

  return Math.min(score, 1.0);
}

export const recallRank: RecallStage = {
  name: "rank",
  enabled: () => true,
  execute: async (input, ctx) => {
    const limit = ctx.config.recallLimit ?? 5;
    const rankingConfig = ctx.config.ranking ?? {};

    const scoredLongTerm = (input.longTerm ?? [])
      .map(r => ({ memory: r.memory, finalScore: scoreMemory(r.memory, r.finalScore, rankingConfig) }))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);

    const scoredSession = (input.session ?? [])
      .map(r => ({ memory: r.memory, finalScore: scoreMemory(r.memory, r.finalScore, rankingConfig) }))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);

    return {
      action: "continue",
      data: { ...input, longTerm: scoredLongTerm, session: scoredSession },
    };
  },
};
```

- [ ] **Step 10: Write recall format stage**

```typescript
// src/pipelines/recall/format.ts

import type { RecallStage, Memory } from "../types.js";

export function formatMemories(
  longTerm: Memory[],
  session: Memory[],
  isSubagent: boolean,
): string {
  const sections: string[] = [];

  if (longTerm.length > 0) {
    sections.push(
      `<long-term-memories>\n${longTerm.map(m => `- ${m.content}`).join("\n")}\n</long-term-memories>`
    );
  }

  if (session.length > 0) {
    sections.push(
      `<session-memories>\n${session.map(m => `- ${m.content}`).join("\n")}\n</session-memories>`
    );
  }

  if (isSubagent && sections.length > 0) {
    sections.unshift(
      "_These memories belong to the parent session. Use for context only._"
    );
  }

  return sections.join("\n\n");
}

export const recallFormat: RecallStage = {
  name: "format",
  enabled: () => true,
  execute: async (input, ctx) => {
    const { isSubagent } = ctx.requestCtx;
    const longTermMemories = (input.longTerm ?? []).map(s => s.memory);
    const sessionMemories = (input.session ?? []).map(s => s.memory);

    if (longTermMemories.length === 0 && sessionMemories.length === 0) {
      return { action: "skip" };
    }

    const formatted = formatMemories(longTermMemories, sessionMemories, isSubagent);

    return {
      action: "continue",
      data: { ...input, formatted },
    };
  },
};
```

- [ ] **Step 11: Write recall pipeline index**

```typescript
// src/pipelines/recall/index.ts

import type { RecallStage } from "../types.js";
import { recallTriggerGate } from "./trigger-gate.js";
import { recallScopeResolver } from "./scope-resolver.js";
import { recallSearch } from "./search.js";
import { recallRank } from "./rank.js";
import { recallFormat } from "./format.js";

export const recallPipeline: RecallStage[] = [
  recallTriggerGate,
  recallScopeResolver,
  recallSearch,
  recallRank,
  recallFormat,
];

export { recallTriggerGate, recallScopeResolver, recallSearch, recallRank, recallFormat };
```

- [ ] **Step 12: Run all recall tests to verify they pass**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/pipelines/recall/`
Expected: PASS — all tests green

- [ ] **Step 13: Commit**

```bash
git add src/pipelines/recall/ tests/pipelines/recall/
git commit -m "feat: add complete recall pipeline (trigger-gate, scope-resolver, search, rank, format)"
```

---

## Task 8: Capture Pipeline — All 6 Stages

**Files:**
- Create: `src/pipelines/capture/trigger-gate.ts`
- Create: `src/pipelines/capture/message-filter.ts`
- Create: `src/pipelines/capture/content-strip.ts`
- Create: `src/pipelines/capture/truncate.ts`
- Create: `src/pipelines/capture/dedup.ts`
- Create: `src/pipelines/capture/store.ts`
- Create: `src/pipelines/capture/index.ts`
- Test: `tests/pipelines/capture/trigger-gate.test.ts`
- Test: `tests/pipelines/capture/message-filter.test.ts`
- Test: `tests/pipelines/capture/content-strip.test.ts`
- Test: `tests/pipelines/capture/truncate.test.ts`
- Test: `tests/pipelines/capture/dedup.test.ts`
- Test: `tests/pipelines/capture/store.test.ts`

- [ ] **Step 1: Write capture trigger gate test**

```typescript
// tests/pipelines/capture/trigger-gate.test.ts
import { describe, test, expect } from "vitest";
import { captureTriggerGate } from "../../../src/pipelines/capture/trigger-gate.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(overrides: Partial<PipelineContext["requestCtx"]> = {}): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "agent:main:abc",
      agentId: "main",
      channel: null,
      trigger: null,
      prompt: "real conversation prompt here",
      isSubagent: false,
      parentSessionKey: null,
      namespace: "default",
      timestamp: Date.now(),
      ...overrides,
    },
    config: { autoCapture: { enabled: true, tier: "smart" } } as any,
    client: {} as any,
  };
}

const input: CaptureInput = { messages: [{ role: "user", content: "hello world" }] };

describe("captureTriggerGate", () => {
  test("continues for interactive prompts", async () => {
    const result = await captureTriggerGate.execute(input, ctx());
    expect(result.action).toBe("continue");
  });

  test("skips for heartbeat trigger", async () => {
    const result = await captureTriggerGate.execute(input, ctx({ trigger: "heartbeat" }));
    expect(result.action).toBe("skip");
  });

  test("skips for subagent when policy is skip", async () => {
    const result = await captureTriggerGate.execute(input, {
      ...ctx({ isSubagent: true }),
      config: { namespace: { subagentPolicy: "skip" } } as any,
    });
    expect(result.action).toBe("skip");
  });

  test("continues for subagent when policy is inherit", async () => {
    const result = await captureTriggerGate.execute(input, ctx({ isSubagent: true }));
    expect(result.action).toBe("continue");
  });
});
```

- [ ] **Step 2: Write message filter test**

```typescript
// tests/pipelines/capture/message-filter.test.ts
import { describe, test, expect } from "vitest";
import { captureMessageFilter } from "../../../src/pipelines/capture/message-filter.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: {} as any,
    client: {} as any,
  };
}

describe("captureMessageFilter", () => {
  test("drops noise messages and keeps real ones", async () => {
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "How do I configure the database?" },
        { role: "user", content: "ok" },
        { role: "user", content: "HEARTBEAT_OK" },
        { role: "assistant", content: "You can configure it by editing the .env file with your connection string." },
        { role: "assistant", content: "Sure! How can I help you with that?" },
      ],
    };
    const result = await captureMessageFilter.execute(input, ctx());
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      // Should keep: database question + .env answer. Drop: ok, HEARTBEAT_OK, boilerplate
      expect(result.data.messages.length).toBe(2);
      expect(result.data.messages[0].content).toContain("database");
      expect(result.data.messages[1].content).toContain(".env");
    }
  });

  test("skips when all messages are noise", async () => {
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "ok" },
        { role: "user", content: "thanks" },
      ],
    };
    const result = await captureMessageFilter.execute(input, ctx());
    expect(result.action).toBe("skip");
  });
});
```

- [ ] **Step 3: Write content strip test**

```typescript
// tests/pipelines/capture/content-strip.test.ts
import { describe, test, expect } from "vitest";
import { captureContentStrip } from "../../../src/pipelines/capture/content-strip.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: { autoCapture: { stripLargeCodeBlocks: true } } as any,
    client: {} as any,
  };
}

describe("captureContentStrip", () => {
  test("strips workflow blocks from messages", async () => {
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "Important fact <memoryrelay-workflow>stuff</memoryrelay-workflow> here" },
      ],
    };
    const result = await captureContentStrip.execute(input, ctx());
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.messages[0].content).not.toContain("memoryrelay-workflow");
      expect(result.data.messages[0].content).toContain("Important fact");
    }
  });

  test("drops messages that become empty after stripping", async () => {
    const input: CaptureInput = {
      messages: [
        { role: "system", content: "<system-reminder>only this</system-reminder>" },
      ],
    };
    const result = await captureContentStrip.execute(input, ctx());
    expect(result.action).toBe("skip");
  });
});
```

- [ ] **Step 4: Write truncate test**

```typescript
// tests/pipelines/capture/truncate.test.ts
import { describe, test, expect } from "vitest";
import { captureTruncate } from "../../../src/pipelines/capture/truncate.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(maxLen?: number): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: { autoCapture: { maxMessageLength: maxLen ?? 2000 } } as any,
    client: {} as any,
  };
}

describe("captureTruncate", () => {
  test("truncates messages over limit", async () => {
    const longContent = "x".repeat(3000);
    const input: CaptureInput = {
      messages: [{ role: "user", content: longContent }],
    };
    const result = await captureTruncate.execute(input, ctx(2000));
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.messages[0].content.length).toBe(2001); // 2000 + "…"
    }
  });

  test("leaves short messages unchanged", async () => {
    const input: CaptureInput = {
      messages: [{ role: "user", content: "short message" }],
    };
    const result = await captureTruncate.execute(input, ctx());
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.messages[0].content).toBe("short message");
    }
  });
});
```

- [ ] **Step 5: Write dedup test**

```typescript
// tests/pipelines/capture/dedup.test.ts
import { describe, test, expect, vi } from "vitest";
import { captureDedup } from "../../../src/pipelines/capture/dedup.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(searchResults: any[] = []): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: {} as any,
    client: {
      search: vi.fn(async () => searchResults),
      store: vi.fn(),
      list: vi.fn(),
      getOrCreateSession: vi.fn(),
      endSession: vi.fn(),
    },
  };
}

describe("captureDedup", () => {
  test("keeps messages with no near-duplicates", async () => {
    const input: CaptureInput = {
      messages: [{ role: "user", content: "My API key rotates every 30 days" }],
    };
    const result = await captureDedup.execute(input, ctx([]));
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.data.messages.length).toBe(1);
    }
  });

  test("removes messages that already exist in memory", async () => {
    const input: CaptureInput = {
      messages: [{ role: "user", content: "My API key rotates every 30 days" }],
    };
    const existing = [{ memory: { id: "m1", content: "API key rotates monthly" }, score: 0.96 }];
    const result = await captureDedup.execute(input, ctx(existing));
    expect(result.action).toBe("skip");
  });
});
```

- [ ] **Step 6: Write store test**

```typescript
// tests/pipelines/capture/store.test.ts
import { describe, test, expect, vi } from "vitest";
import { captureStore } from "../../../src/pipelines/capture/store.js";
import type { PipelineContext, CaptureInput } from "../../../src/pipelines/types.js";

function ctx(): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: {} as any,
    client: {
      search: vi.fn(),
      store: vi.fn(async (content: string) => ({
        id: "mem-new", content, agent_id: "a1", user_id: "u1",
        metadata: {}, entities: [], created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
      list: vi.fn(),
      getOrCreateSession: vi.fn(),
      endSession: vi.fn(),
    },
  };
}

describe("captureStore", () => {
  test("stores messages with resolved scope", async () => {
    const pctx = ctx();
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "I always prefer dark mode for my IDE" },
        { role: "user", content: "The error is on line 42 of the config file" },
      ],
    };
    const result = await captureStore.execute(input, pctx);
    expect(result.action).toBe("continue");
    expect(pctx.client.store).toHaveBeenCalledTimes(2);

    // First call: "always prefer" → long-term
    const firstCall = (pctx.client.store as any).mock.calls[0];
    expect(firstCall[0]).toContain("dark mode");
    expect(firstCall[1]).toEqual(expect.objectContaining({ source: "auto-capture" }));

    // Second call: general context → session
    const secondCall = (pctx.client.store as any).mock.calls[1];
    expect(secondCall[0]).toContain("line 42");
  });

  test("caps at 3 stored memories per capture", async () => {
    const pctx = ctx();
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "I always use TypeScript for new projects" },
        { role: "user", content: "Remember that the deploy needs approval" },
        { role: "user", content: "The API endpoint is api.example.com" },
        { role: "user", content: "I decided to use PostgreSQL for this" },
        { role: "user", content: "The convention is to use kebab-case" },
      ],
    };
    await captureStore.execute(input, pctx);
    expect(pctx.client.store).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 7: Run all capture tests to verify they fail**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/pipelines/capture/`
Expected: FAIL — modules don't exist

- [ ] **Step 8: Write capture trigger gate**

```typescript
// src/pipelines/capture/trigger-gate.ts

import type { CaptureStage } from "../types.js";
import { isNonInteractive } from "../../filters/non-interactive.js";

export const captureTriggerGate: CaptureStage = {
  name: "trigger-gate",
  enabled: () => true,
  execute: async (input, ctx) => {
    if (isNonInteractive({
      trigger: ctx.requestCtx.trigger,
      sessionKey: ctx.requestCtx.sessionKey,
      prompt: ctx.requestCtx.prompt,
    })) {
      return { action: "skip" };
    }

    // Also skip subagents when policy is "skip"
    if (ctx.requestCtx.isSubagent) {
      const policy = ctx.config.namespace?.subagentPolicy ?? "inherit";
      if (policy === "skip") {
        return { action: "skip" };
      }
    }

    return { action: "continue", data: input };
  },
};
```

- [ ] **Step 9: Write capture message filter**

```typescript
// src/pipelines/capture/message-filter.ts

import type { CaptureStage } from "../types.js";
import { shouldDropMessage, isAssistantBoilerplate } from "../../filters/noise-patterns.js";

export const captureMessageFilter: CaptureStage = {
  name: "message-filter",
  enabled: () => true,
  execute: async (input, _ctx) => {
    const kept = input.messages.filter(msg => {
      if (shouldDropMessage(msg)) return false;
      if (isAssistantBoilerplate(msg)) return false;
      return true;
    });

    if (kept.length === 0) return { action: "skip" };
    return { action: "continue", data: { messages: kept } };
  },
};
```

- [ ] **Step 10: Write capture content strip**

```typescript
// src/pipelines/capture/content-strip.ts

import type { CaptureStage } from "../types.js";
import { stripContent } from "../../filters/content-patterns.js";

export const captureContentStrip: CaptureStage = {
  name: "content-strip",
  enabled: () => true,
  execute: async (input, _ctx) => {
    const cleaned = input.messages
      .map(msg => ({ ...msg, content: stripContent(msg.content) }))
      .filter(msg => msg.content.length >= 10);

    if (cleaned.length === 0) return { action: "skip" };
    return { action: "continue", data: { messages: cleaned } };
  },
};
```

- [ ] **Step 11: Write capture truncate**

```typescript
// src/pipelines/capture/truncate.ts

import type { CaptureStage } from "../types.js";

export const captureTruncate: CaptureStage = {
  name: "truncate",
  enabled: () => true,
  execute: async (input, ctx) => {
    const maxLength = ctx.config.autoCapture?.maxMessageLength ?? 2000;
    const truncated = input.messages.map(msg => ({
      ...msg,
      content: msg.content.length > maxLength
        ? msg.content.slice(0, maxLength) + "\u2026"
        : msg.content,
    }));
    return { action: "continue", data: { messages: truncated } };
  },
};
```

- [ ] **Step 12: Write capture dedup**

```typescript
// src/pipelines/capture/dedup.ts

import type { CaptureStage } from "../types.js";

export const captureDedup: CaptureStage = {
  name: "dedup",
  enabled: () => true,
  execute: async (input, ctx) => {
    const kept = [];
    for (const msg of input.messages) {
      const existing = await ctx.client.search(msg.content, 1, 0.95);
      if (existing.length === 0) {
        kept.push(msg);
      }
    }

    if (kept.length === 0) return { action: "skip" };
    return { action: "continue", data: { messages: kept } };
  },
};
```

- [ ] **Step 13: Write capture store**

```typescript
// src/pipelines/capture/store.ts

import type { CaptureStage } from "../types.js";
import { resolveScope } from "../../filters/content-patterns.js";

export const captureStore: CaptureStage = {
  name: "store",
  enabled: () => true,
  execute: async (input, ctx) => {
    const maxCapture = 3;
    const toStore = input.messages.slice(0, maxCapture);

    for (const msg of toStore) {
      const scope = resolveScope(msg.content);
      await ctx.client.store(msg.content, {
        source: "auto-capture",
        scope,
      }, { scope });
    }

    return { action: "continue", data: input };
  },
};
```

- [ ] **Step 14: Write capture pipeline index**

```typescript
// src/pipelines/capture/index.ts

import type { CaptureStage } from "../types.js";
import { captureTriggerGate } from "./trigger-gate.js";
import { captureMessageFilter } from "./message-filter.js";
import { captureContentStrip } from "./content-strip.js";
import { captureTruncate } from "./truncate.js";
import { captureDedup } from "./dedup.js";
import { captureStore } from "./store.js";

export const capturePipeline: CaptureStage[] = [
  captureTriggerGate,
  captureMessageFilter,
  captureContentStrip,
  captureTruncate,
  captureDedup,
  captureStore,
];

export { captureTriggerGate, captureMessageFilter, captureContentStrip, captureTruncate, captureDedup, captureStore };
```

- [ ] **Step 15: Run all capture tests to verify they pass**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run tests/pipelines/capture/`
Expected: PASS — all tests green

- [ ] **Step 16: Commit**

```bash
git add src/pipelines/capture/ tests/pipelines/capture/
git commit -m "feat: add complete capture pipeline (trigger-gate, message-filter, content-strip, truncate, dedup, store)"
```

---

## Task 9: Extract API Client

**Files:**
- Create: `src/client/memoryrelay-client.ts`

This is a pure extraction — move the `MemoryRelayClient` class (lines 656-1354 of `index.ts`), `fetchWithTimeout`, and related constants into their own module. The class interface must match what `src/pipelines/types.ts` declares.

- [ ] **Step 1: Extract API client**

Copy `MemoryRelayClient` class, `fetchWithTimeout`, `DEFAULT_API_URL`, `REQUEST_TIMEOUT_MS`, `MAX_RETRIES`, `INITIAL_RETRY_DELAY_MS` from `index.ts` lines 43-1354 into `src/client/memoryrelay-client.ts`. Add proper exports:

```typescript
// src/client/memoryrelay-client.ts
// Top of file:
export const DEFAULT_API_URL = "https://api.memoryrelay.net";
// ... (copy constants and fetchWithTimeout helper)
// ... (copy full MemoryRelayClient class)
export { MemoryRelayClient };
```

Keep the existing method signatures unchanged. Add `scope`, `session_id`, and `namespace` as optional parameters to the `search()` method signature, passing them through to the API request query string:

```typescript
async search(
  query: string,
  limit: number = 5,
  threshold: number = 0.3,
  opts?: { scope?: string; session_id?: string; namespace?: string },
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    threshold: String(threshold),
  });
  if (opts?.scope) params.set("scope", opts.scope);
  if (opts?.session_id) params.set("session_id", opts.session_id);
  if (opts?.namespace) params.set("namespace", opts.namespace);
  return this.request<SearchResult[]>("GET", `/v1/memories/search?${params}`);
}
```

Similarly, add `scope` to the `store()` method's options parameter, passing it through in the request body.

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run`
Expected: PASS — existing tests unaffected (they use MockMemoryRelayClient)

- [ ] **Step 3: Commit**

```bash
git add src/client/memoryrelay-client.ts
git commit -m "refactor: extract MemoryRelayClient to src/client/ with scope/namespace support"
```

---

## Task 10: Extract Hooks

**Files:**
- Create: `src/hooks/before-agent-start.ts`
- Create: `src/hooks/before-prompt-build.ts`
- Create: `src/hooks/agent-end.ts`
- Create: `src/hooks/session-lifecycle.ts`
- Create: `src/hooks/subagent.ts`
- Create: `src/hooks/compaction.ts`
- Create: `src/hooks/activity.ts`
- Create: `src/hooks/privacy.ts`

Each hook module exports a registration function that takes `(api, config, client, sessionResolver)` and registers the hook. The `before-prompt-build` and `agent-end` hooks delegate to the recall and capture pipelines respectively. The `before-agent-start` hook (workflow instructions) is extracted unchanged from `index.ts` lines 4142-4239.

- [ ] **Step 1: Extract before-agent-start hook**

Copy the `before_agent_start` handler from `index.ts` lines 4142-4239 (workflow instructions injection) into its own module:

```typescript
// src/hooks/before-agent-start.ts

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";

export function registerBeforeAgentStart(
  api: OpenClawPluginApi,
  config: PluginConfig,
  isToolEnabled: (name: string) => boolean,
): void {
  api.on("before_agent_start", async (event) => {
    // Copy the full workflow instructions logic from index.ts lines 4142-4239
    // This is a straight extraction — no behavioral changes
    // ... (full existing code)
  });
}
```

- [ ] **Step 2: Write before-prompt-build hook**

```typescript
// src/hooks/before-prompt-build.ts

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient } from "../pipelines/types.js";
import { buildRequestContext } from "../context/request-context.js";
import { runPipeline } from "../pipelines/runner.js";
import { recallPipeline } from "../pipelines/recall/index.js";

export function registerBeforePromptBuild(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
): void {
  api.on("before_prompt_build", async (event) => {
    if (!config.autoRecall) return;

    // Check channel exclusions
    if (config.excludeChannels && event.channel) {
      const channelId = String(event.channel);
      if (config.excludeChannels.some((excluded: string) => channelId.includes(excluded))) {
        return;
      }
    }

    try {
      const requestCtx = buildRequestContext(event, config);
      const pipelineCtx = { requestCtx, config, client };

      const result = await runPipeline(recallPipeline, {
        prompt: requestCtx.prompt,
        memories: [],
        scope: "all" as const,
      }, pipelineCtx);

      if (!result || !result.formatted) return;

      api.logger.info?.(`memory-memoryrelay: injecting memories into context`);
      return { prependContext: result.formatted };
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: recall failed: ${String(err)}`);
    }
  });
}
```

- [ ] **Step 2: Write agent-end hook**

```typescript
// src/hooks/agent-end.ts

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient, ConversationMessage } from "../pipelines/types.js";
import { buildRequestContext } from "../context/request-context.js";
import { runPipeline } from "../pipelines/runner.js";
import { capturePipeline } from "../pipelines/capture/index.js";

export function registerAgentEnd(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
): void {
  if (!config.autoCapture?.enabled) return;

  api.on("agent_end", async (event) => {
    if (!event.success || !event.messages || event.messages.length === 0) return;

    try {
      const messages: ConversationMessage[] = [];
      for (const msg of event.messages) {
        if (!msg || typeof msg !== "object") continue;
        const msgObj = msg as Record<string, unknown>;
        const role = msgObj.role as string;
        if (role !== "user" && role !== "assistant") continue;

        const content = msgObj.content;
        if (typeof content === "string") {
          messages.push({ role: role as "user" | "assistant", content });
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object" && (block as any).type === "text" && (block as any).text) {
              messages.push({ role: role as "user" | "assistant", content: (block as any).text });
            }
          }
        }
      }

      if (messages.length === 0) return;

      const requestCtx = buildRequestContext(event, config);
      const pipelineCtx = { requestCtx, config, client };

      await runPipeline(capturePipeline, { messages }, pipelineCtx);
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: capture failed: ${String(err)}`);
    }
  });
}
```

- [ ] **Step 3: Write session lifecycle hooks**

```typescript
// src/hooks/session-lifecycle.ts

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient } from "../pipelines/types.js";
import type { SessionResolver } from "../context/session-resolver.js";
import { buildRequestContext } from "../context/request-context.js";

export function registerSessionLifecycle(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  sessionResolver: SessionResolver,
): void {
  api.on("session_start", async (event, _ctx) => {
    try {
      const requestCtx = buildRequestContext(event, config);
      if (!requestCtx.sessionKey) return;
      await sessionResolver.resolve(requestCtx);
      api.logger.debug?.(`memory-memoryrelay: session started for ${requestCtx.sessionKey}`);
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: session_start hook failed: ${String(err)}`);
    }
  });

  api.on("session_end", async (event, _ctx) => {
    try {
      const externalId = event.sessionKey || event.sessionId;
      if (!externalId) return;
      await sessionResolver.endSession(externalId, `Session ended after ${event.messageCount} messages`);
      api.logger.debug?.(`memory-memoryrelay: session ended for ${externalId}`);
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: session_end hook failed: ${String(err)}`);
    }
  });
}
```

- [ ] **Step 4: Write subagent hooks**

```typescript
// src/hooks/subagent.ts

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient } from "../pipelines/types.js";

export function registerSubagentHooks(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
): void {
  api.on("subagent_spawned", async (event, _ctx) => {
    try {
      api.logger.debug?.(
        `memory-memoryrelay: subagent spawned: ${event.agentId} (session: ${event.childSessionKey}, label: ${event.label || "none"})`
      );
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: subagent_spawned hook failed: ${String(err)}`);
    }
  });

  api.on("subagent_ended", async (event, _ctx) => {
    try {
      const outcome = event.outcome || "unknown";
      if (outcome === "ok" || outcome === "success") {
        api.logger.debug?.(`memory-memoryrelay: skipping routine subagent completion`);
        return;
      }

      if (!config.autoCapture?.enabled) return;

      const summary = `Subagent ${event.targetSessionKey} ended: ${event.reason} (outcome: ${outcome})`;
      const blocklist = config.autoCapture?.blocklist ?? [];
      if (blocklist.some(p => { try { return new RegExp(p, "i").test(summary); } catch { return false; } })) {
        return;
      }

      await client.store(summary, {
        category: "subagent-activity",
        source: "subagent_ended_hook",
        agent: config.agentId ?? "",
        outcome,
      });
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: subagent_ended hook failed: ${String(err)}`);
    }
  });
}
```

- [ ] **Step 5: Write compaction hooks**

```typescript
// src/hooks/compaction.ts

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient } from "../pipelines/types.js";

function extractRescueContent(messages: unknown[], blocklist: string[]): string[] {
  const rescued: string[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    if (m.role !== "assistant") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (content.length < 200) continue;
    if (blocklist.some(p => { try { return new RegExp(p, "i").test(content); } catch { return false; } })) continue;
    rescued.push(content.slice(0, 2000));
  }
  return rescued.slice(0, 3);
}

export function registerCompactionHooks(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
): void {
  const blocklist = config.autoCapture?.blocklist ?? [];

  api.on("before_compaction", async (event, _ctx) => {
    if (!event.messages || event.messages.length === 0) return;
    try {
      const rescued = extractRescueContent(event.messages, blocklist);
      for (const content of rescued) {
        await client.store(content, {
          category: "compaction-rescue",
          source: "auto-compaction",
          agent: config.agentId ?? "",
        });
      }
      if (rescued.length > 0) {
        api.logger.info?.(`memory-memoryrelay: rescued ${rescued.length} memories before compaction`);
      }
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: compaction rescue failed: ${String(err)}`);
    }
  });

  api.on("before_reset", async (event, _ctx) => {
    if (!event.messages || event.messages.length === 0) return;
    try {
      const rescued = extractRescueContent(event.messages, blocklist);
      for (const content of rescued) {
        await client.store(content, {
          category: "session-reset-rescue",
          source: "auto-reset",
          agent: config.agentId ?? "",
        });
      }
      if (rescued.length > 0) {
        api.logger.info?.(`memory-memoryrelay: rescued ${rescued.length} memories before reset`);
      }
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: reset rescue failed: ${String(err)}`);
    }
  });
}
```

- [ ] **Step 6: Write activity hooks**

```typescript
// src/hooks/activity.ts

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { DebugLogger } from "../debug-logger.js";

export function registerActivityHooks(
  api: OpenClawPluginApi,
  debugLogger?: DebugLogger,
): void {
  api.on("before_tool_call", (_event, _ctx) => {
    // Reserved for future: tool blocking, param injection, audit
  });

  api.on("after_tool_call", (event, _ctx) => {
    if (debugLogger) {
      debugLogger.log({
        timestamp: new Date().toISOString(),
        tool: event.toolName,
        method: "tool_call",
        path: "",
        duration: event.durationMs || 0,
        status: event.error ? "error" : "success",
        error: event.error,
      });
    }
  });

  api.on("message_received", (_event, _ctx) => {
    // Activity tracking handled by session resolver
  });

  api.on("message_sending", (_event, _ctx) => {
    // No-op: registered for future extensibility
  });
}
```

- [ ] **Step 7: Write privacy hooks**

```typescript
// src/hooks/privacy.ts

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../pipelines/types.js";

function isBlocklisted(content: string, blocklist: string[]): boolean {
  return blocklist.some(pattern => {
    try { return new RegExp(pattern, "i").test(content); }
    catch { return false; }
  });
}

function redactSensitive(content: string, blocklist: string[]): string {
  let redacted = content;
  for (const pattern of blocklist) {
    try { redacted = redacted.replace(new RegExp(pattern, "gi"), "[REDACTED]"); }
    catch { /* skip invalid regex */ }
  }
  return redacted;
}

export function registerPrivacyHooks(
  api: OpenClawPluginApi,
  config: PluginConfig,
): void {
  const blocklist = config.autoCapture?.blocklist ?? [];
  if (blocklist.length === 0) return;

  api.on("before_message_write", (event, _ctx) => {
    const msg = event.message;
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;
    if (typeof m.content === "string" && isBlocklisted(m.content, blocklist)) {
      return {
        message: { ...msg, content: redactSensitive(m.content as string, blocklist) } as typeof msg,
      };
    }
  });

  api.on("tool_result_persist", (event, _ctx) => {
    const msg = event.message;
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;
    if (typeof m.content === "string" && isBlocklisted(m.content, blocklist)) {
      return {
        message: { ...msg, content: redactSensitive(m.content as string, blocklist) } as typeof msg,
      };
    }
  });
}
```

- [ ] **Step 8: Commit**

```bash
git add src/hooks/
git commit -m "refactor: extract all lifecycle hooks into src/hooks/ modules"
```

---

## Task 11: Extract Tools

**Files:**
- Create: `src/tools/memory-tools.ts`
- Create: `src/tools/session-tools.ts`
- Create: `src/tools/entity-tools.ts`
- Create: `src/tools/decision-tools.ts`
- Create: `src/tools/pattern-tools.ts`
- Create: `src/tools/project-tools.ts`
- Create: `src/tools/agent-tools.ts`
- Create: `src/tools/v2-tools.ts`
- Create: `src/tools/health-tools.ts`

This is a mechanical extraction. Each tool module exports a registration function.

- [ ] **Step 1: Extract tools**

Each tool module follows this pattern:

```typescript
// src/tools/memory-tools.ts (example shape — repeat for each group)

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig, MemoryRelayClient } from "../pipelines/types.js";
import type { SessionResolver } from "../context/session-resolver.js";

export function registerMemoryTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  client: MemoryRelayClient,
  sessionResolver: SessionResolver,
  isToolEnabled: (name: string) => boolean,
): void {
  // Copy memory_store, memory_recall, memory_forget, memory_list,
  // memory_get, memory_update, memory_batch_store, memory_context,
  // memory_promote from index.ts lines 1679-2320
  // Add `scope` parameter to memory_store, memory_search (memory_recall), memory_list
  // For memory_store: add scope to parameters schema and pass through to client.store()
  // For memory_recall: add scope to parameters schema and pass through to client.search()
  // For memory_list: add scope to parameters schema and pass through to client.list()
}
```

For each of the 9 tool groups, copy the `api.registerTool()` blocks from `index.ts` into the appropriate module. The tool code stays identical except:

1. **memory_store** — add `scope` parameter:
   ```typescript
   scope: {
     type: "string",
     description: "Memory scope: 'session' (current conversation) or 'long-term' (persistent). Default: 'long-term'.",
     enum: ["session", "long-term"],
   },
   ```
   Pass `scope` through to `client.store()` options.

2. **memory_recall** — add `scope` parameter:
   ```typescript
   scope: {
     type: "string",
     description: "Search scope: 'session', 'long-term', or 'all'. Default: 'all'.",
     enum: ["session", "long-term", "all"],
   },
   ```
   Pass `scope` through to `client.search()` options.

3. **memory_list** — add `scope` parameter:
   ```typescript
   scope: {
     type: "string",
     description: "List scope: 'session', 'long-term', or 'all'. Default: 'all'.",
     enum: ["session", "long-term", "all"],
   },
   ```

All other tools are unchanged — straight copy.

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/
git commit -m "refactor: extract all 42 tools into src/tools/ modules with scope parameter support"
```

---

## Task 12: Rewrite index.ts as Wiring

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Rewrite index.ts**

Replace the 5700-line monolith with ~200 lines of wiring:

```typescript
// index.ts
/**
 * OpenClaw Memory Plugin - MemoryRelay v0.16.0
 *
 * Pipeline architecture with smart recall, precision-first capture,
 * session-scoped memories, namespace routing, and concurrency safety.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { MemoryRelayClient, DEFAULT_API_URL } from "./src/client/memoryrelay-client.js";
import { DebugLogger } from "./src/debug-logger.js";
import { StatusReporter } from "./src/status-reporter.js";
import { SessionResolver } from "./src/context/session-resolver.js";
import type { PluginConfig } from "./src/pipelines/types.js";

// Hooks
import { registerBeforeAgentStart } from "./src/hooks/before-agent-start.js";
import { registerBeforePromptBuild } from "./src/hooks/before-prompt-build.js";
import { registerAgentEnd } from "./src/hooks/agent-end.js";
import { registerSessionLifecycle } from "./src/hooks/session-lifecycle.js";
import { registerSubagentHooks } from "./src/hooks/subagent.js";
import { registerCompactionHooks } from "./src/hooks/compaction.js";
import { registerActivityHooks } from "./src/hooks/activity.js";
import { registerPrivacyHooks } from "./src/hooks/privacy.js";

// Tools
import { registerMemoryTools } from "./src/tools/memory-tools.js";
import { registerSessionTools } from "./src/tools/session-tools.js";
import { registerEntityTools } from "./src/tools/entity-tools.js";
import { registerDecisionTools } from "./src/tools/decision-tools.js";
import { registerPatternTools } from "./src/tools/pattern-tools.js";
import { registerProjectTools } from "./src/tools/project-tools.js";
import { registerAgentTools } from "./src/tools/agent-tools.js";
import { registerV2Tools } from "./src/tools/v2-tools.js";
import { registerHealthTools } from "./src/tools/health-tools.js";

// Existing modules
import { checkFirstRun, runSimpleOnboarding, generateSuccessMessage } from "./src/onboarding/first-run.js";

// Auto-capture config normalization (keep inline — small helper)
function normalizeAutoCaptureConfig(raw: any): PluginConfig["autoCapture"] {
  if (!raw || raw === false) return { enabled: false, tier: "off" };
  if (raw === true) return { enabled: true, tier: "smart" };
  if (typeof raw === "object") {
    return {
      enabled: raw.enabled !== false,
      tier: raw.tier || "smart",
      confirmFirst: raw.confirmFirst ?? 5,
      maxMessageLength: raw.maxMessageLength ?? 2000,
      stripLargeCodeBlocks: raw.stripLargeCodeBlocks ?? true,
      categories: {
        credentials: raw.categories?.credentials ?? true,
        preferences: raw.categories?.preferences ?? true,
        technical: raw.categories?.technical ?? true,
        personal: raw.categories?.personal ?? false,
      },
      blocklist: raw.blocklist ?? [
        "password\\s*[:=]\\s*[^\\s]+",
        "credit\\s*card",
        "ssn\\s*[:=]",
        "social\\s*security",
      ],
    };
  }
  return { enabled: false, tier: "off" };
}

// Tool group definitions (unchanged from v0.15)
const TOOL_GROUPS: Record<string, string[]> = {
  memory: ["memory_store", "memory_recall", "memory_forget", "memory_list", "memory_get", "memory_update", "memory_batch_store", "memory_context", "memory_promote"],
  entity: ["entity_create", "entity_link", "entity_list", "entity_graph"],
  agent: ["agent_list", "agent_create", "agent_get"],
  session: ["session_start", "session_end", "session_recall", "session_list"],
  decision: ["decision_record", "decision_list", "decision_supersede", "decision_check"],
  pattern: ["pattern_create", "pattern_search", "pattern_adopt", "pattern_suggest"],
  project: ["project_register", "project_list", "project_info", "project_add_relationship", "project_dependencies", "project_dependents", "project_related", "project_impact", "project_shared_patterns", "project_context"],
  health: ["memory_health"],
  v2: ["memory_store_async", "memory_status", "context_build"],
};

export default async function plugin(api: OpenClawPluginApi): Promise<void> {
  const cfg = api.pluginConfig as any;

  const apiKey = cfg?.apiKey || process.env.MEMORYRELAY_API_KEY;
  const agentId = cfg?.agentId || process.env.MEMORYRELAY_AGENT_ID || api.agentName;

  if (!apiKey) {
    api.logger.error("memory-memoryrelay: Missing API key in config or MEMORYRELAY_API_KEY env var.");
    return;
  }
  if (!agentId) {
    api.logger.error("memory-memoryrelay: Missing agentId in config or MEMORYRELAY_AGENT_ID env var");
    return;
  }

  const apiUrl = cfg?.apiUrl || process.env.MEMORYRELAY_API_URL || DEFAULT_API_URL;
  const autoCapture = normalizeAutoCaptureConfig(cfg?.autoCapture);

  const config: PluginConfig = {
    ...cfg,
    apiKey,
    agentId,
    apiUrl,
    autoCapture,
  };

  // Debug + status
  const debugLogger = config.debug ? new DebugLogger({
    enabled: true,
    verbose: config.verbose || false,
    maxEntries: config.maxLogEntries || 100,
  }) : undefined;
  const statusReporter = new StatusReporter(debugLogger);

  // Core services
  const client = new MemoryRelayClient(apiKey, agentId, apiUrl, debugLogger, statusReporter);
  const sessionResolver = new SessionResolver(client as any, config);

  // Stale session cleanup interval
  const cleanupIntervalMs = (config.sessionCleanupIntervalMinutes ?? 30) * 60_000;
  setInterval(() => sessionResolver.cleanupStale(), cleanupIntervalMs);

  // Tool enablement check
  const isToolEnabled = (name: string): boolean => {
    if (!cfg?.tools) return true;
    return cfg.tools[name] !== false;
  };

  // Register hooks
  registerBeforeAgentStart(api, config, isToolEnabled);
  registerBeforePromptBuild(api, config, client as any);
  registerAgentEnd(api, config, client as any);
  registerSessionLifecycle(api, config, client as any, sessionResolver);
  registerSubagentHooks(api, config, client as any);
  registerCompactionHooks(api, config, client as any);
  registerActivityHooks(api, debugLogger);
  registerPrivacyHooks(api, config);

  // Register tools
  registerMemoryTools(api, config, client as any, sessionResolver, isToolEnabled);
  registerSessionTools(api, config, client as any, sessionResolver, isToolEnabled);
  registerEntityTools(api, config, client as any, isToolEnabled);
  registerDecisionTools(api, config, client as any, isToolEnabled);
  registerPatternTools(api, config, client as any, isToolEnabled);
  registerProjectTools(api, config, client as any, isToolEnabled);
  registerAgentTools(api, config, client as any, isToolEnabled);
  registerV2Tools(api, config, client as any, isToolEnabled);
  registerHealthTools(api, config, client as any, isToolEnabled);

  // Gateway methods, commands, onboarding (keep registering here — thin wiring)
  // ... (copy gateway method and command registrations from original index.ts)

  api.logger.info?.(
    `memory-memoryrelay: plugin v0.16.0 loaded (${Object.values(TOOL_GROUPS).flat().length} tools, autoRecall: ${config.autoRecall}, autoCapture: ${autoCapture?.enabled ? autoCapture.tier : "off"}, debug: ${config.debug || false})`,
  );

  // Onboarding (unchanged)
  try {
    const onboardingCheck = await checkFirstRun(async () => {
      const memories = await (client as any).list(1);
      return memories.length;
    });
    if (onboardingCheck.shouldOnboard) {
      await runSimpleOnboarding(
        async (content, metadata) => {
          const memory = await (client as any).store(content, metadata || {});
          return { id: memory.id };
        },
        "Welcome to MemoryRelay! This is your first memory.",
        autoCapture?.enabled || false,
      );
      api.logger.info?.(`\n${generateSuccessMessage("Welcome!", autoCapture?.enabled || false)}`);
    }
  } catch (err) {
    api.logger.warn?.(`memory-memoryrelay: onboarding check failed: ${String(err)}`);
  }
}
```

Note: The gateway methods (memoryrelay.logs, memoryrelay.health, memoryrelay.metrics, etc.) and CLI commands (17 `registerCommand` calls) remain in `index.ts` as thin wiring. They're small registration blocks that don't need their own modules.

- [ ] **Step 2: Run all tests**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run`
Expected: PASS — all existing and new tests green

- [ ] **Step 3: Commit**

```bash
git add index.ts
git commit -m "refactor: rewrite index.ts as pipeline wiring (~200 lines, was 5700)"
```

---

## Task 13: Update Plugin Manifest & Version

**Files:**
- Modify: `openclaw.plugin.json`
- Modify: `package.json`

- [ ] **Step 1: Update plugin manifest with new config fields**

Add `namespace` and `ranking` config schema to `openclaw.plugin.json`:

```json
{
  "namespace": {
    "type": "object",
    "properties": {
      "isolateAgents": { "type": "boolean", "default": false },
      "subagentPolicy": {
        "type": "string",
        "enum": ["inherit", "isolate", "skip"],
        "default": "inherit"
      }
    }
  },
  "ranking": {
    "type": "object",
    "properties": {
      "freshnessBoost": { "type": "boolean", "default": true },
      "freshnessWindowHours": { "type": "number", "default": 24, "minimum": 1, "maximum": 168 },
      "importanceBoost": { "type": "boolean", "default": true },
      "tierBoost": { "type": "boolean", "default": true }
    }
  }
}
```

Add UI hints for new fields:

```json
{
  "namespace.isolateAgents": {
    "label": "Isolate Agent Memories",
    "help": "Keep each agent's memories separate. Disable to share across all agents."
  },
  "namespace.subagentPolicy": {
    "label": "Subagent Memory Policy",
    "help": "inherit: subagents use parent's memories. isolate: separate namespace. skip: no memory access."
  },
  "autoCapture.maxMessageLength": {
    "label": "Max Capture Length",
    "help": "Messages longer than this are truncated before capture."
  },
  "autoCapture.stripLargeCodeBlocks": {
    "label": "Strip Large Code Blocks",
    "help": "Remove code blocks over 500 chars from captured content."
  }
}
```

Also update manifest version to `0.16.0` and description.

- [ ] **Step 2: Bump package.json version**

Change `"version": "0.15.8"` to `"version": "0.16.0"` in `package.json`.

- [ ] **Step 3: Commit**

```bash
git add openclaw.plugin.json package.json
git commit -m "chore: bump to v0.16.0, add namespace and ranking config schema"
```

---

## Task 14: Integration Tests

**Files:**
- Create: `tests/integration/recall-pipeline.test.ts`
- Create: `tests/integration/capture-pipeline.test.ts`

- [ ] **Step 1: Write recall integration test**

```typescript
// tests/integration/recall-pipeline.test.ts
import { describe, test, expect, vi } from "vitest";
import { runPipeline } from "../../src/pipelines/runner.js";
import { recallPipeline } from "../../src/pipelines/recall/index.js";
import { buildRequestContext } from "../../src/context/request-context.js";
import type { PipelineContext, RecallInput, MemoryRelayClient } from "../../src/pipelines/types.js";

function mockClient(longTermResults: any[] = [], sessionResults: any[] = []): MemoryRelayClient {
  return {
    search: vi.fn(async (_q, _l, _t, opts) => {
      if (opts?.scope === "long-term") return longTermResults;
      if (opts?.scope === "session") return sessionResults;
      return [];
    }),
    store: vi.fn(),
    list: vi.fn(),
    getOrCreateSession: vi.fn(),
    endSession: vi.fn(),
  };
}

describe("recall pipeline end-to-end", () => {
  test("produces formatted output with both scopes", async () => {
    const client = mockClient(
      [{ memory: { id: "m1", content: "User prefers dark mode", created_at: new Date().toISOString(), importance: 0.8 }, score: 0.85 }],
      [{ memory: { id: "m2", content: "Working on auth bug fix", created_at: new Date().toISOString() }, score: 0.9 }],
    );
    const config = { autoRecall: true, recallLimit: 5, recallThreshold: 0.3, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "What are my preferences?" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };

    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt,
      memories: [],
      scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("<long-term-memories>");
    expect(result!.formatted).toContain("dark mode");
    expect(result!.formatted).toContain("<session-memories>");
    expect(result!.formatted).toContain("auth bug");
  });

  test("skips entirely for non-interactive trigger", async () => {
    const client = mockClient();
    const config = { autoRecall: true, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:cron:daily", trigger: "cron" }, prompt: "HEARTBEAT_OK" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };

    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt,
      memories: [],
      scope: "all" as const,
    }, pipelineCtx);

    expect(result).toBeNull();
    expect(client.search).not.toHaveBeenCalled();
  });

  test("routes subagent recall to parent with notice", async () => {
    const client = mockClient(
      [{ memory: { id: "m1", content: "Parent's preference", created_at: new Date().toISOString() }, score: 0.8 }],
      [],
    );
    const config = { autoRecall: true, agentId: "test", namespace: { subagentPolicy: "inherit" } };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:subagent:task-uuid" }, prompt: "What context do I have?" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };

    const result = await runPipeline(recallPipeline, {
      prompt: requestCtx.prompt,
      memories: [],
      scope: "all" as const,
    }, pipelineCtx);

    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("parent session");
    expect(result!.formatted).toContain("Parent's preference");
  });
});
```

- [ ] **Step 2: Write capture integration test**

```typescript
// tests/integration/capture-pipeline.test.ts
import { describe, test, expect, vi } from "vitest";
import { runPipeline } from "../../src/pipelines/runner.js";
import { capturePipeline } from "../../src/pipelines/capture/index.js";
import { buildRequestContext } from "../../src/context/request-context.js";
import type { PipelineContext, CaptureInput, MemoryRelayClient } from "../../src/pipelines/types.js";

function mockClient(): MemoryRelayClient {
  return {
    search: vi.fn(async () => []),
    store: vi.fn(async (content: string) => ({
      id: "m-new", content, agent_id: "a", user_id: "u",
      metadata: {}, entities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    list: vi.fn(),
    getOrCreateSession: vi.fn(),
    endSession: vi.fn(),
  };
}

describe("capture pipeline end-to-end", () => {
  test("filters noise and stores valuable content", async () => {
    const client = mockClient();
    const config = { autoCapture: { enabled: true, tier: "smart", maxMessageLength: 2000 }, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:abc" }, prompt: "Help me configure the database" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };

    const input: CaptureInput = {
      messages: [
        { role: "user", content: "I always prefer PostgreSQL for production databases" },
        { role: "user", content: "ok" },
        { role: "assistant", content: "Sure! How can I help you with that?" },
        { role: "assistant", content: "You should configure the DATABASE_URL in your .env file. The format is postgres://user:pass@host:5432/dbname" },
      ],
    };

    await runPipeline(capturePipeline, input, pipelineCtx);

    // "ok" dropped (noise), boilerplate dropped, 2 messages should be captured
    expect(client.store).toHaveBeenCalledTimes(2);
    // First: long-term (contains "always prefer")
    const firstContent = (client.store as any).mock.calls[0][0];
    expect(firstContent).toContain("PostgreSQL");
    // Second: session (general technical context)
    const secondContent = (client.store as any).mock.calls[1][0];
    expect(secondContent).toContain("DATABASE_URL");
  });

  test("skips entirely for heartbeat trigger", async () => {
    const client = mockClient();
    const config = { autoCapture: { enabled: true, tier: "smart" }, agentId: "test" };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "sys:heartbeat:check", trigger: "heartbeat" }, prompt: "HEARTBEAT_OK" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };

    const result = await runPipeline(capturePipeline, {
      messages: [{ role: "user", content: "HEARTBEAT_OK" }],
    }, pipelineCtx);

    expect(result).toBeNull();
    expect(client.store).not.toHaveBeenCalled();
  });

  test("skips capture for subagent with skip policy", async () => {
    const client = mockClient();
    const config = { autoCapture: { enabled: true }, agentId: "test", namespace: { subagentPolicy: "skip" } };
    const requestCtx = buildRequestContext(
      { ctx: { sessionKey: "agent:main:subagent:xyz" }, prompt: "Subagent work" },
      config as any,
    );
    const pipelineCtx: PipelineContext = { requestCtx, config: config as any, client };

    const result = await runPipeline(capturePipeline, {
      messages: [{ role: "user", content: "Some subagent conversation content here" }],
    }, pipelineCtx);

    expect(result).toBeNull();
    expect(client.store).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run`
Expected: PASS — all unit + integration tests green

- [ ] **Step 4: Commit**

```bash
git add tests/integration/
git commit -m "test: add end-to-end integration tests for recall and capture pipelines"
```

---

## Task 15: Final Verification & PR

- [ ] **Step 1: Run full test suite with coverage**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx vitest run --coverage`
Expected: PASS — all tests green, coverage report generated

- [ ] **Step 2: Verify plugin loads**

Run: `cd /home/ubuntu/claude/openclaw-plugin && npx tsc --noEmit` (if tsconfig exists)
Or verify the plugin compiles by checking for syntax errors.

- [ ] **Step 3: Update CLAUDE.md**

Update the Architecture section of `/home/ubuntu/claude/openclaw-plugin/CLAUDE.md` to reflect the new module structure. Replace the monolithic description with the pipeline architecture overview.

- [ ] **Step 4: Commit final changes**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for v0.16 pipeline architecture"
```

- [ ] **Step 5: Create PR**

```bash
gh pr create -R memoryrelay/openclaw-plugin \
  --title "feat: v0.16 smart recall & capture pipeline architecture" \
  --body "## Summary
- Decomposes monolithic index.ts (5700 lines) into pipeline architecture (~200 lines wiring)
- Adds recall pipeline: trigger-gate → scope-resolver → search → rank → format
- Adds capture pipeline: trigger-gate → message-filter → content-strip → truncate → dedup → store
- Adds session-scoped (short-term) memories alongside long-term
- Adds namespace routing with configurable agent isolation and subagent policies
- Adds concurrency-safe request context (replaces shared mutable state)
- Adds non-interactive trigger detection (skips cron, heartbeat, automation)
- Adds precision-first noise filtering with information density scoring
- Adds composite recall ranking (similarity + freshness + importance + tier)
- All new config fields have smart defaults, zero configuration required

Closes #53

## Test plan
- [ ] Unit tests for all pipeline stages, filters, and context modules
- [ ] Integration tests for full recall and capture pipelines
- [ ] Backward compatibility: existing config produces identical behavior
- [ ] Verify plugin loads and registers all 42 tools + 14 hooks
"
```
