import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import plugin from "../index.js";

// OpenClaw 2026.9 refuses a plugin whose register returns a promise
// ("plugin register must be synchronous"), so 0.25.0 failed to load at all.
describe("plugin register", () => {
  const home = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = mkdtempSync(join(tmpdir(), "mr-register-"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "healthy" }), { status: 200 })));
  });

  afterEach(() => {
    process.env.HOME = home;
    vi.unstubAllGlobals();
  });

  test("returns synchronously and has registered its tools by then", () => {
    const calls: string[] = [];
    const api = new Proxy(
      {
        pluginConfig: { apiKey: "mem_test_key", agentId: "test-agent", localCache: { enabled: false } },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      } as Record<string, unknown>,
      {
        get(target, prop: string) {
          if (prop in target) return target[prop];
          if (prop === "then") return undefined;
          return () => {
            calls.push(prop);
          };
        },
      },
    );

    const result = (plugin as (api: unknown) => unknown)(api);

    expect(result).toBeUndefined();
    expect(calls).toContain("registerTool");
  });
});
