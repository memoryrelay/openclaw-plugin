/**
 * Packaging guards for issue #138.
 *
 * OpenClaw's startup migration refuses to install a plugin whose entry point is
 * TypeScript source with no compiled output — it looks for ./dist/index.js,
 * index.js, index.mjs or index.cjs and aborts the whole gateway boot when none
 * exist. v0.23.0/v0.24.0 shipped `"main": "index.ts"` and crash-looped every
 * OpenClaw >= 2026.7.1 that installed them.
 *
 * These tests assert the published package describes, and actually produces, a
 * runnable JavaScript entry point.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  main: string;
  files: string[];
  scripts: Record<string, string>;
  openclaw?: { extensions?: string[] };
};

/** The extensions OpenClaw accepts as a plugin runtime entry point. */
const RUNTIME_EXTENSIONS = [".js", ".mjs", ".cjs"];

const isCompiledEntry = (entry: string) =>
  RUNTIME_EXTENSIONS.some((ext) => entry.endsWith(ext));

describe("package manifest", () => {
  it('declares a compiled "main", not TypeScript source', () => {
    expect(pkg.main).toBeTruthy();
    expect(pkg.main.endsWith(".ts")).toBe(false);
    expect(isCompiledEntry(pkg.main)).toBe(true);
  });

  it("declares compiled openclaw extension entry points", () => {
    const extensions = pkg.openclaw?.extensions ?? [];
    expect(extensions.length).toBeGreaterThan(0);
    for (const entry of extensions) {
      expect(isCompiledEntry(entry), `${entry} is not a compiled entry`).toBe(true);
    }
  });

  it('includes the compiled output directory in "files"', () => {
    // Without this the build output exists locally but never reaches the tarball.
    const mainDir = dirname(pkg.main.replace(/^\.\//, "")).split("/")[0];
    const covered = pkg.files.some(
      (entry) => entry.replace(/\/$/, "") === mainDir,
    );
    expect(covered, `"files" does not include "${mainDir}/"`).toBe(true);
  });

  it("builds before publishing", () => {
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.scripts.prepublishOnly).toContain("build");
  });
});

describe("build output", () => {
  const mainPath = join(ROOT, pkg.main);

  beforeAll(() => {
    execFileSync("node", [join(ROOT, "scripts", "build.mjs")], {
      cwd: ROOT,
      stdio: "pipe",
    });
  }, 120_000);

  it('emits the file "main" points at', () => {
    expect(existsSync(mainPath), `${pkg.main} was not emitted`).toBe(true);
    expect(statSync(mainPath).size).toBeGreaterThan(0);
  });

  it("emits plain JavaScript with no leftover type syntax", () => {
    const code = readFileSync(mainPath, "utf8");
    expect(code).not.toMatch(/^import type /m);
    expect(code).not.toMatch(/\bfrom "openclaw\/plugin-sdk"/);
  });

  it("loads in Node and exports the plugin factory", async () => {
    // Catches unresolved relative specifiers (ESM needs explicit ".js"
    // extensions) and module-scope crashes such as reading package.json from
    // the wrong directory once the entry moves into dist/.
    const mod = (await import(pathToFileURL(mainPath).href)) as {
      default?: unknown;
    };
    expect(typeof mod.default).toBe("function");
  });
});
