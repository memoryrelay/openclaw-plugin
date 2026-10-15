/**
 * package.json owns the version and the package name. Every other place that
 * restates them must agree: 0.30.0 shipped with the manifest, the index.ts
 * header and the User-Agent still saying 0.29.1, and the tag workflow wrote
 * release notes for a package that does not exist (@memoryrelay/openclaw-plugin).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { USER_AGENT } from "../src/client/memoryrelay-client.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const pkg = JSON.parse(read("package.json")) as { name: string; version: string };

describe("version consistency", () => {
  test("package-lock.json has the package.json version", () => {
    const lock = JSON.parse(read("package-lock.json")) as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
  });

  test("openclaw.plugin.json has the package.json version, in its version and its description", () => {
    const manifest = JSON.parse(read("openclaw.plugin.json")) as { version: string; description: string };
    expect(manifest.version).toBe(pkg.version);
    for (const [, v] of manifest.description.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)) expect(v).toBe(pkg.version);
  });

  test("the index.ts header has the package.json version", () => {
    const header = /^ \* Version: (\S+)$/m.exec(read("index.ts"));
    expect(header?.[1]).toBe(pkg.version);
  });

  test("the client's User-Agent has the package.json version", () => {
    expect(USER_AGENT).toBe(`openclaw-plugin-memoryrelay-ai/${pkg.version}`);
    const literals = read("src/client/memoryrelay-client.ts").match(/openclaw-plugin-memoryrelay-ai\/\d+\.\d+\.\d+/g) ?? [];
    expect(literals).toEqual([USER_AGENT]);
  });

  test("workflows name no @memoryrelay package but this one", () => {
    const dir = join(ROOT, ".github", "workflows");
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      for (const name of read(join(".github", "workflows", file)).match(/@memoryrelay\/[a-z0-9-]+/g) ?? []) {
        expect(name, file).toBe(pkg.name);
      }
    }
  });
});
