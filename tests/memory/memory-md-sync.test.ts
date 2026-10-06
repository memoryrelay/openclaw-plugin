import { describe, expect, test, vi, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import plugin from "../../index.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryMdSync,
  parseMemoryMd,
  redactSecrets,
  resolveMemoryMdPath,
} from "../../src/memory/memory-md-sync.js";

const MEMORY = `# Jarvis Knowledge Base

Owner notes at the top.

## Infrastructure

### NorthRelay Production
- API on port 3000, deploys via GitHub Actions.

### Pool Gateways
- Two gateways behind the relay.

## Critical Gotchas
\`\`\`bash
# not a heading: a shell comment
sudo systemctl restart foo
\`\`\`

### Pool Gateways
- A second section with the same title.

## Promoted From Short-Term Memory (2026-10-05)

<!-- openclaw-memory-promotion:abc123 -->
- Webhook connector maps replies back to the session for 24h. [score=0.912 signals=3 recalls=4 avg=0.800 source=memory/2026-10-03.md:44-44]
<!-- openclaw-memory-promotion:def456 -->
- Command Center is the only HTTP subscriber. [score=0.850]
`;

describe("parseMemoryMd", () => {
  const entries = parseMemoryMd(MEMORY);

  test("one entry per section with text, keyed by its heading path", () => {
    expect(entries.filter((e) => e.source === "memory-md").map((e) => e.key)).toEqual([
      "section:Jarvis Knowledge Base",
      "section:Jarvis Knowledge Base › Infrastructure › NorthRelay Production",
      "section:Jarvis Knowledge Base › Infrastructure › Pool Gateways",
      "section:Jarvis Knowledge Base › Critical Gotchas",
      "section:Jarvis Knowledge Base › Critical Gotchas › Pool Gateways",
    ]);
    // "Infrastructure" has only subsections, so no entry of its own.
    const prod = entries.find((e) => e.headingPath.endsWith("NorthRelay Production"))!;
    expect(prod.content).toBe(
      "MEMORY.md › Jarvis Knowledge Base › Infrastructure › NorthRelay Production\n\n- API on port 3000, deploys via GitHub Actions.",
    );
  });

  test("a fenced comment is body, not a heading", () => {
    const gotchas = entries.find((e) => e.key === "section:Jarvis Knowledge Base › Critical Gotchas")!;
    expect(gotchas.content).toContain("# not a heading: a shell comment");
  });

  test("dreaming promotions are their own entries, keyed by the marker", () => {
    const promoted = entries.filter((e) => e.source === "dreaming");
    expect(promoted.map((e) => e.key)).toEqual(["promotion:abc123", "promotion:def456"]);
    expect(promoted[0].content).toContain("Webhook connector maps replies back to the session for 24h.");
    expect(promoted[0].content).not.toContain("openclaw-memory-promotion");
    // The promotion section has no text of its own once the entries are out.
    expect(entries.some((e) => e.key.includes("Promoted From Short-Term Memory") && e.source === "memory-md")).toBe(false);
  });

  test("the same heading path twice gets a distinct key", () => {
    const md = "## A\nx\n## A\ny\n";
    expect(parseMemoryMd(md).map((e) => e.key)).toEqual(["section:A", "section:A #2"]);
  });
});

describe("redactSecrets", () => {
  test("drops credential values and keeps the prose", () => {
    const text = [
      "MemoryRelay key mem_prod_abcdefghijklmnopqrstuvwx is in the env.",
      "GitHub token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 for CI.",
      "password: hunter2hunter2",
      "API_KEY=sk-ant-REDACTMEREDACTMEREDACTME",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----",
      "Telegram bot 123456789:AAHsomethingSomethingSomethingSomething1",
      "The API listens on port 3000 and the password policy is strict.",
    ].join("\n");
    const out = redactSecrets(text);
    expect(out).not.toMatch(/mem_prod_abc|ghp_ABC|hunter2|sk-ant-RED|abcdefghijklmnopqrstuvwxyz123456|AAAA|AAHsomething/);
    expect(out).toContain("password: [REDACTED]");
    expect(out).toContain("Bearer [REDACTED]");
    expect(out).toContain("The API listens on port 3000 and the password policy is strict.");
  });

  test("the shapes found in a real MEMORY.md (dry run on Jarvis, 0.29.0)", () => {
    const hex = "f3c1".repeat(16);
    const pw = "da5e".repeat(16);
    const text = [
      `- **API Key**: ${hex} (Jarvis Scanner)`,
      `- **Stalwart admin**: \`curl -sk 'https://127.0.0.1:8443/api' -u 'admin:${pw}'\``,
      "- **Client Secret** = abcdefgh12345678",
      "- DB: postgresql://memrelay:s3cretPassw0rd@db:5432/memory",
      "- **Server**: 51.161.10.58:2222 (ubuntu, key: ~/.ssh/id_northrelay)",
      "- **Agent ID**: a9200000-0000-4000-8000-000000000000",
    ].join("\n");
    const out = redactSecrets(text);
    expect(out).not.toContain(hex);
    expect(out).not.toContain(pw);
    expect(out).not.toContain("abcdefgh12345678");
    expect(out).not.toContain("s3cretPassw0rd");
    expect(out).toContain("-u 'admin:[REDACTED]'");
    expect(out).toContain("postgresql://memrelay:[REDACTED]@db:5432/memory");
    // Not secrets: addresses, key file names and ids stay.
    expect(out).toContain("51.161.10.58:2222 (ubuntu, key: ~/.ssh/id_northrelay)");
    expect(out).toContain("a9200000-0000-4000-8000-000000000000");
  });

  test("applies the capture blocklist too", () => {
    expect(redactSecrets("my ssn: 123", ["ssn\\s*[:=]"])).toBe("my [REDACTED] 123");
  });
});

function fakeClient() {
  let n = 0;
  return {
    store: vi.fn(async (content: string, _metadata?: Record<string, string>, _options?: unknown) => ({ id: `m${++n}`, content }) as never),
    update: vi.fn(async (id: string, content: string) => ({ id, content }) as never),
    delete: vi.fn(async () => undefined),
  };
}

describe("MemoryMdSync", () => {
  let dir: string;
  let path: string;
  let statePath: string;
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mdsync-"));
    path = join(dir, "MEMORY.md");
    statePath = join(dir, "state", "memory-md-sync.json");
    writeFileSync(path, MEMORY);
  });
  const mirror = (client: ReturnType<typeof fakeClient>) => new MemoryMdSync(client, { path, statePath, log });

  test("first sync stores every entry, tagged, and keeps a private state file", async () => {
    const client = fakeClient();
    const result = await mirror(client).sync();
    expect(result).toMatchObject({ stored: 7, updated: 0, deleted: 0, failed: 0 });
    const [content, metadata, options] = client.store.mock.calls[1] as unknown as [string, Record<string, string>, unknown];
    expect(content).toContain("NorthRelay Production");
    expect(metadata).toEqual({
      source: "memory-md",
      memory_md_key: "section:Jarvis Knowledge Base › Infrastructure › NorthRelay Production",
      memory_md_file: path,
    });
    expect(options).toEqual({ deduplicate: false });
    expect(client.store.mock.calls.map((c) => (c[1] as Record<string, string>).source)).toContain("dreaming");
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
  });

  test("an unchanged file sends nothing; a new process with the same state sends nothing either", async () => {
    const client = fakeClient();
    const m = mirror(client);
    await m.sync();
    expect(await m.sync()).toMatchObject({ skipped: "unchanged" });
    const again = fakeClient();
    expect(await mirror(again).sync()).toMatchObject({ stored: 0, updated: 0, unchanged: 7 });
    expect(again.store).not.toHaveBeenCalled();
  });

  test("an edited section is updated in place, a removed one deleted", async () => {
    const client = fakeClient();
    await mirror(client).sync();
    writeFileSync(
      path,
      MEMORY.replace("deploys via GitHub Actions", "deploys via GitHub Actions on merge").replace(
        "### Pool Gateways\n- Two gateways behind the relay.\n",
        "",
      ),
    );
    const result = await mirror(client).sync();
    expect(result).toMatchObject({ stored: 0, updated: 1, deleted: 1 });
    expect(client.update.mock.calls[0][0]).toBe("m2");
    expect(client.update.mock.calls[0][1]).toContain("on merge");
    expect(client.delete).toHaveBeenCalledWith("m3");
  });

  test("an emptied file deletes nothing", async () => {
    const client = fakeClient();
    await mirror(client).sync();
    writeFileSync(path, "");
    expect(await mirror(client).sync()).toMatchObject({ deleted: 0 });
    expect(client.delete).not.toHaveBeenCalled();
  });

  test("a memory deleted in MemoryRelay is stored again; a failure is retried next time", async () => {
    const client = fakeClient();
    const m = mirror(client);
    await m.sync();
    writeFileSync(path, MEMORY.replace("Two gateways", "Three gateways"));
    client.update.mockRejectedValueOnce(new Error("API request failed: 404 Not Found"));
    expect(await m.sync()).toMatchObject({ stored: 1, updated: 0 });

    writeFileSync(path, MEMORY.replace("Two gateways", "Four gateways"));
    client.update.mockRejectedValueOnce(new Error("API request failed: 503"));
    expect(await m.sync()).toMatchObject({ failed: 1 });
    expect(await m.sync()).toMatchObject({ updated: 1, failed: 0 });
  });

  test("secrets are redacted before they are sent", async () => {
    writeFileSync(path, "## Keys\nMemoryRelay key mem_prod_abcdefghijklmnopqrstuvwx\npassword: hunter2hunter2\n");
    const client = fakeClient();
    await mirror(client).sync();
    const sent = client.store.mock.calls.map((c) => c[0]).join("\n");
    expect(sent).not.toMatch(/mem_prod_abc|hunter2/);
    expect(sent).toContain("[REDACTED]");
  });

  test("another process holding the lock skips this run; a stale lock is taken over", async () => {
    const client = fakeClient();
    const m = mirror(client);
    await m.sync(); // creates the state dir
    writeFileSync(path, MEMORY + "\n## New\ntext\n");
    writeFileSync(`${statePath}.lock`, "");
    expect(await m.sync()).toMatchObject({ skipped: "locked" });
    const old = new Date(Date.now() - 11 * 60 * 1000);
    const { utimesSync } = await import("node:fs");
    utimesSync(`${statePath}.lock`, old, old);
    expect(await m.sync()).toMatchObject({ stored: 1 });
    expect(existsSync(`${statePath}.lock`)).toBe(false);
  });

  test("a missing file is a no-op", async () => {
    const client = fakeClient();
    expect(await new MemoryMdSync(client, { path: join(dir, "nope.md"), statePath, log }).sync()).toMatchObject({
      skipped: "no file",
    });
  });
});

describe("resolveMemoryMdPath", () => {
  const config = {
    agents: { defaults: { workspace: "/w/default" }, entries: { jarvis: { workspace: "/w/jarvis/" } } },
  };
  test("configured path, then the agent's workspace, then the default, then ~/.openclaw/workspace", () => {
    const has = (paths: string[]) => (p: string) => paths.includes(p);
    expect(resolveMemoryMdPath({ configuredPath: "/x.md", openclawHome: "/h", exists: () => false })).toBe("/x.md");
    expect(
      resolveMemoryMdPath({ openclawConfig: config, agentId: "jarvis", openclawHome: "/h", exists: has(["/w/jarvis/MEMORY.md", "/w/default/MEMORY.md"]) }),
    ).toBe("/w/jarvis/MEMORY.md");
    expect(
      resolveMemoryMdPath({ openclawConfig: config, agentId: "jarvis", openclawHome: "/h", exists: has(["/w/default/MEMORY.md"]) }),
    ).toBe("/w/default/MEMORY.md");
    expect(resolveMemoryMdPath({ openclawConfig: config, agentId: "other", openclawHome: "/h", exists: has(["/h/workspace/MEMORY.md"]) })).toBe(
      "/h/workspace/MEMORY.md",
    );
    expect(resolveMemoryMdPath({ openclawHome: "/h", exists: () => false })).toBeUndefined();
  });
});

describe("plugin wiring", () => {
  function register(config: Record<string, unknown>) {
    const hooks: Record<string, Array<(...args: unknown[]) => unknown>> = {};
    const api = new Proxy(
      {
        pluginConfig: { apiKey: "mem_test_key", agentId: "jarvis", localCache: { enabled: false }, ...config },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        on: (name: string, handler: (...args: unknown[]) => unknown) => {
          (hooks[name] ??= []).push(handler);
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
    return { hooks, api: api as unknown as { logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } } };
  }

  test("off by default: no gateway_start handler", () => {
    expect(register({}).hooks.gateway_start).toBeUndefined();
  });

  test("on: gateway_start finds the agent's MEMORY.md and starts mirroring it", () => {
    const home = mkdtempSync(join(tmpdir(), "mdsync-home-"));
    mkdirSync(join(home, "workspace"));
    writeFileSync(join(home, "workspace", "MEMORY.md"), "## A\nx\n");
    const previous = process.env.OPENCLAW_HOME;
    process.env.OPENCLAW_HOME = home;
    vi.useFakeTimers();
    try {
      const { hooks, api } = register({ memoryMdSync: { enabled: true, intervalMinutes: 30 } });
      expect(hooks.gateway_start).toHaveLength(1);
      hooks.gateway_start[0]({}, {});
      expect(api.logger.info).toHaveBeenCalledWith(expect.stringContaining(`mirroring ${join(home, "workspace", "MEMORY.md")}`));
      // A second registration in the same process does not start a second mirror.
      const again = register({ memoryMdSync: { enabled: true } });
      again.hooks.gateway_start[0]({}, {});
      expect(again.api.logger.info).not.toHaveBeenCalledWith(expect.stringContaining("mirroring"));
    } finally {
      vi.useRealTimers();
      process.env.OPENCLAW_HOME = previous;
    }
  });
});
