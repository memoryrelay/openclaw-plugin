import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import plugin from "../index.js";

// OpenClaw 2026.9 rejects registerTool unless the manifest names the tool in
// contracts.tools ("plugin must declare contracts.tools before registering
// agent tools"), so a tool missing from the manifest is silently absent.
describe("manifest contracts.tools", () => {
  const home = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = mkdtempSync(join(tmpdir(), "mr-contracts-"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });

  afterEach(() => {
    process.env.HOME = home;
    vi.unstubAllGlobals();
  });

  test("declares exactly the tools the plugin registers", () => {
    const registered = new Set<string>();
    const api = new Proxy(
      {
        pluginConfig: { apiKey: "mem_test_key", agentId: "test-agent", localCache: { enabled: false } },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerTool: (tool: unknown, opts?: { name?: string; names?: string[] }) => {
          for (const n of [...(opts?.names ?? []), ...(opts?.name ? [opts.name] : [])]) registered.add(n);
          const resolved = typeof tool === "function" ? (tool as (ctx: unknown) => { name?: string })({}) : (tool as { name?: string });
          if (resolved?.name) registered.add(resolved.name);
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

    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "openclaw.plugin.json"), "utf8"));
    expect(registered.size).toBeGreaterThan(0);
    expect([...(manifest.contracts?.tools ?? [])].sort()).toEqual([...registered].sort());
  });
});
