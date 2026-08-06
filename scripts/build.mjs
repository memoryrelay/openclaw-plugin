#!/usr/bin/env node
/**
 * Compile the TypeScript sources to ESM JavaScript in dist/.
 *
 * OpenClaw refuses to install a plugin whose entry point is a .ts file — it
 * looks for ./dist/index.js, index.js, index.mjs or index.cjs and aborts the
 * startup migration when none exist (issue #138). The published package must
 * therefore carry compiled output.
 *
 * This is a transpile-only build: ts.transpileModule() erases types file by
 * file without type checking, which keeps the build green while the 70-odd
 * pre-existing type errors against the OpenClaw plugin SDK are worked through
 * separately. Run `npm run typecheck` to see them.
 *
 * The output mirrors the source layout (index.ts -> dist/index.js,
 * src/x.ts -> dist/src/x.js) so the existing "./src/*.js" import specifiers
 * resolve unchanged.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "dist");
const ENTRY = "index.ts";
const SRC_DIR = "src";

/** Matches the runtime the package declares: Node >=20, "type": "module". */
const COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  sourceMap: true,
  removeComments: false,
  useDefineForClassFields: true,
};

/** Collect every compilable .ts file under `dir`, relative to ROOT. */
function collect(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collect(rel));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      out.push(rel);
    }
  }
  return out;
}

function transpile(srcRel) {
  const outRel = srcRel.replace(/\.ts$/, ".js");
  const outPath = join(OUT_DIR, outRel);
  const mapName = `${basename(outPath)}.map`;

  const result = ts.transpileModule(readFileSync(join(ROOT, srcRel), "utf8"), {
    fileName: srcRel,
    compilerOptions: COMPILER_OPTIONS,
  });

  // transpileModule points the map at its own `fileName`; rewrite it to a path
  // that resolves from the emitted file's directory to the original source.
  const map = JSON.parse(result.sourceMapText);
  map.file = basename(outPath);
  map.sources = [relative(dirname(outPath), join(ROOT, srcRel))];

  const code = `${result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/, "")}\n//# sourceMappingURL=${mapName}\n`;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code);
  writeFileSync(`${outPath}.map`, JSON.stringify(map));
  return outRel;
}

rmSync(OUT_DIR, { recursive: true, force: true });

const sources = [ENTRY, ...collect(SRC_DIR)];
const emitted = sources.map(transpile);

// The whole point of the build: fail loudly rather than publish a package
// OpenClaw will refuse to install.
if (!emitted.includes("index.js")) {
  console.error("build: no dist/index.js was emitted");
  process.exit(1);
}

console.log(`build: emitted ${emitted.length} files to dist/`);
