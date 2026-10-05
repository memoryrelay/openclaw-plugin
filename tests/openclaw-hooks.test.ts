import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import plugin from "../index.js";

// Typed hook names OpenClaw 2026.9.1 dispatches (pluginHookNameSet in its
// hook runner). A name outside it is logged as `unknown typed hook ... ignored`
// and never runs: 0.25.2 lost pinned ICM context that way, because
// before_agent_start no longer exists. The dev dependency is older and still
// types it, so this list is the check, not the compiler.
const OPENCLAW_2026_9_HOOKS = new Set([
  "before_model_resolve", "agent_turn_prepare", "before_prompt_build", "before_agent_reply",
  "model_call_started", "model_call_ended", "llm_input", "llm_output", "before_agent_finalize",
  "agent_end", "before_compaction", "after_compaction", "before_reset", "inbound_claim",
  "channel_pairing_requested", "message_received", "message_sending", "reply_payload_sending",
  "message_sent", "before_tool_call", "after_tool_call", "tool_result_persist",
  "before_message_write", "session_start", "session_end", "subagent_delivery_target",
  "subagent_spawned", "subagent_progress", "subagent_ended", "gateway_start", "gateway_stop",
  "heartbeat_prompt_contribution", "cron_reconciled", "cron_changed", "skill_proposal_evaluate",
  "skill_proposal_changed", "skill_changed", "before_dispatch", "reply_dispatch",
  "before_install", "before_agent_run", "resolve_exec_env",
]);

describe("OpenClaw 2026.9 hooks", () => {
  const home = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = mkdtempSync(join(tmpdir(), "mr-hooks-"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });

  afterEach(() => {
    process.env.HOME = home;
    vi.unstubAllGlobals();
  });

  test("every hook the plugin registers is one 2026.9 dispatches", () => {
    const hooks: string[] = [];
    const api = new Proxy(
      {
        pluginConfig: { apiKey: "mem_test_key", agentId: "test-agent", localCache: { enabled: false } },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        on: (name: string) => { hooks.push(name); },
      } as Record<string, unknown>,
      {
        get(target, prop: string) {
          if (prop in target) return target[prop];
          if (prop === "then") return undefined;
          return () => undefined;
        },
      },
    );

    (plugin as (api: unknown) => unknown)(api);

    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks.filter((h) => !OPENCLAW_2026_9_HOOKS.has(h))).toEqual([]);
  });

  test("pinned ICM context is registered ahead of recall on before_prompt_build", () => {
    const order: string[] = [];
    const api = new Proxy(
      {
        pluginConfig: { apiKey: "mem_test_key", agentId: "test-agent", localCache: { enabled: false } },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        on: (name: string, fn: { toString(): string }) => {
          if (name === "before_prompt_build") order.push(fn.toString().includes("icm") ? "icm" : "recall");
        },
      } as Record<string, unknown>,
      {
        get(target, prop: string) {
          if (prop in target) return target[prop];
          if (prop === "then") return undefined;
          return () => undefined;
        },
      },
    );

    (plugin as (api: unknown) => unknown)(api);

    expect(order).toEqual(["icm", "recall"]);
  });
});
