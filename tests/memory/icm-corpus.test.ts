import { describe, expect, test, vi, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readZipText } from "../../src/memory/zip.js";
import { IcmCorpus, sectionsOf } from "../../src/memory/icm-corpus.js";
import { combineCorpusSupplements, type MemoryCorpusSupplement } from "../../src/memory/corpus-supplement.js";
import { IcmApiError, type IcmSearchResponse } from "../../src/client/memoryrelay-client.js";
import { makeZip } from "./zip-fixture.js";

const R1 = "a".repeat(64);
const R2 = "b".repeat(64);

describe("readZipText", () => {
  test("reads stored and deflated entries as UTF-8", () => {
    const files = { "CLAUDE.md": "# Entry\nhéllo ✓\n", "docs/a.md": "x".repeat(5000) };
    expect(Object.fromEntries(readZipText(makeZip(files)))).toEqual(files);
    expect(Object.fromEntries(readZipText(makeZip(files, { deflate: true })))).toEqual(files);
  });

  test("rejects what is not a zip", () => {
    expect(() => readZipText(new TextEncoder().encode("not a zip at all, just some text here"))).toThrow(/zip/);
  });
});

describe("sectionsOf", () => {
  test("splits at headings and keeps 1-based line ranges", () => {
    const sections = sectionsOf("f.md", "intro\n# One\nalpha\n## Two\nbeta\n");
    expect(sections.map((s) => [s.title, s.startLine, s.endLine])).toEqual([
      ["f.md", 1, 1],
      ["One", 2, 3],
      ["Two", 4, 6],
    ]);
  });

  test("caps a long section at 40 lines", () => {
    const sections = sectionsOf("long.md", Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"));
    expect(sections.map((s) => s.endLine - s.startLine + 1)).toEqual([40, 40, 20]);
  });
});

function fakeClient(state: { release: string; files: Record<string, string> }) {
  return {
    icmListWorkspaces: vi.fn(async () => ({
      workspaces: [
        { id: "ws-1", slug: "api", name: "MemoryRelay API" },
        { id: "ws-2", slug: "off", name: "Off", enabled: false },
        { id: "ws-3", slug: "empty", name: "No release" },
      ],
    })),
    icmGetChannel: vi.fn(async (id: string) => {
      if (id === "ws-3") throw new Error("404");
      return { channel: "live", release_id: state.release, revision: 1 };
    }),
    icmExportRelease: vi.fn(async () => makeZip({ ...state.files, "manifest.json": "{}" }, { deflate: true })),
    // A server from before GET /v2/icm/search: the corpus searches its own copy.
    icmSearch: vi.fn(async (): Promise<IcmSearchResponse> => {
      throw new IcmApiError(404, "not_found", "Not Found");
    }),
  };
}

const FILES = {
  "CLAUDE.md": "# MemoryRelay API\nRoutes for fix, feature and release.\n",
  "_shared/deploy.md": "# Deploy\nA merge to main deploys production through deploy.yml.\n## Rollback\nRevert the merge commit.\n",
  "_shared/testing.md": "# Testing\npytest against a real PostgreSQL.\n",
};

describe("IcmCorpus", () => {
  let cacheDir: string;
  let now: number;
  const log = { debug: vi.fn(), warn: vi.fn() };
  beforeEach(() => {
    cacheDir = join(mkdtempSync(join(tmpdir(), "icm-corpus-")), "cache");
    now = 1_000_000;
  });
  const corpus = (client: ReturnType<typeof fakeClient>, extra: Partial<{ workspaces: string[] }> = {}) =>
    new IcmCorpus(client, { cacheDir, log, now: () => now, ...extra });

  test("search ranks the section that matches, with a citable path and lines", async () => {
    const c = corpus(fakeClient({ release: R1, files: FILES }));
    const hits = await c.search({ query: "how does a deploy to production work?" });
    expect(hits[0]).toMatchObject({
      corpus: "icm",
      path: "icm:api/_shared/deploy.md",
      title: "Deploy",
      kind: "icm-file",
      citation: "icm:api/_shared/deploy.md#L1-L2",
      provenanceLabel: "ICM MemoryRelay API",
      startLine: 1,
      endLine: 2,
    });
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].score).toBeLessThan(1);
    expect(hits.map((h) => h.path)).not.toContain("icm:api/manifest.json");
    expect(await c.search({ query: "zzzz-nothing" })).toEqual([]);
  });

  test("skips disabled workspaces and ones without a live release", async () => {
    const client = fakeClient({ release: R1, files: FILES });
    await corpus(client).refresh();
    expect(client.icmGetChannel.mock.calls.map((c) => c[0])).toEqual(["ws-1", "ws-3"]);
    expect(client.icmExportRelease).toHaveBeenCalledTimes(1);
  });

  test("workspaces narrows by slug or id", async () => {
    const client = fakeClient({ release: R1, files: FILES });
    await corpus(client, { workspaces: ["nope"] }).refresh();
    expect(client.icmExportRelease).not.toHaveBeenCalled();
  });

  test("get reads a file, sliced by lines, and declines what is not its own", async () => {
    const c = corpus(fakeClient({ release: R1, files: FILES }));
    const out = await c.get({ lookup: "icm:api/_shared/deploy.md#L3", fromLine: 3, lineCount: 2 });
    expect(out).toMatchObject({
      corpus: "icm",
      path: "icm:api/_shared/deploy.md",
      content: "## Rollback\nRevert the merge commit.",
      fromLine: 3,
      lineCount: 2,
      provenanceLabel: `ICM MemoryRelay API @ ${R1.slice(0, 12)}`,
    });
    expect(await c.get({ lookup: "icm:ws-1/CLAUDE.md" })).toMatchObject({ path: "icm:api/CLAUDE.md" });
    expect(await c.get({ lookup: "icm:api/missing.md" })).toBeNull();
    expect(await c.get({ lookup: "memoryrelay:abc" })).toBeNull();
    expect(await c.get({ lookup: "icm:api" })).toBeNull();
  });

  test("a sandboxed session sees nothing", async () => {
    const client = fakeClient({ release: R1, files: FILES });
    const c = corpus(client);
    expect(await c.search({ query: "deploy", sandboxed: true })).toEqual([]);
    expect(await c.get({ lookup: "icm:api/CLAUDE.md", sandboxed: true })).toBeNull();
    expect(client.icmListWorkspaces).not.toHaveBeenCalled();
  });

  test("refresh is single-flight and rate limited", async () => {
    const client = fakeClient({ release: R1, files: FILES });
    const c = corpus(client);
    await Promise.all([c.refresh(), c.refresh(), c.refresh()]);
    expect(client.icmListWorkspaces).toHaveBeenCalledTimes(1);
    now += 60_000;
    await c.refresh();
    expect(client.icmListWorkspaces).toHaveBeenCalledTimes(1);
    now += 10 * 60_000;
    await c.refresh();
    expect(client.icmListWorkspaces).toHaveBeenCalledTimes(2);
    expect(client.icmExportRelease).toHaveBeenCalledTimes(1); // same release: not fetched again
  });

  test("caches a release on disk privately and reuses it across instances", async () => {
    const state: { release: string; files: Record<string, string> } = { release: R1, files: FILES };
    await corpus(fakeClient(state)).refresh();
    const file = join(cacheDir, `${R1}.json`);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(cacheDir).mode & 0o777).toBe(0o700);

    const second = fakeClient(state);
    const hits = await corpus(second).search({ query: "rollback" });
    expect(hits[0].path).toBe("icm:api/_shared/deploy.md");
    expect(second.icmExportRelease).not.toHaveBeenCalled();
  });

  test("a new live release is fetched and the old cache file pruned", async () => {
    const state: { release: string; files: Record<string, string> } = { release: R1, files: FILES };
    const client = fakeClient(state);
    const c = corpus(client);
    await c.refresh();
    writeFileSync(join(cacheDir, "unrelated.txt"), "keep");
    state.release = R2;
    state.files = { "CLAUDE.md": "# Moved\nEverything changed in kubernetes.\n" };
    await c.refresh(true);
    expect(readdirSync(cacheDir).sort()).toEqual([`${R2}.json`, "unrelated.txt"]);
    expect((await c.search({ query: "kubernetes" }))[0].path).toBe("icm:api/CLAUDE.md");
    expect(await c.search({ query: "rollback" })).toEqual([]);
  });

  test("refuses a release id that is not a content hash", async () => {
    const client = fakeClient({ release: "../../etc/passwd", files: FILES });
    const c = corpus(client);
    await c.refresh();
    expect(client.icmExportRelease).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  test("a failing API leaves search answering with nothing", async () => {
    const client = fakeClient({ release: R1, files: FILES });
    client.icmListWorkspaces.mockRejectedValue(new Error("down"));
    expect(await corpus(client).search({ query: "deploy" })).toEqual([]);
  });
});

describe("IcmCorpus with server-side search", () => {
  let cacheDir: string;
  const log = { debug: vi.fn(), warn: vi.fn() };
  beforeEach(() => {
    cacheDir = join(mkdtempSync(join(tmpdir(), "icm-remote-")), "cache");
    log.warn.mockClear();
  });
  const HIT = {
    workspace_id: "ws-1",
    workspace_slug: "api",
    workspace_name: "MemoryRelay API",
    release_id: R1,
    path: "_shared/deploy.md",
    heading: "Deploy",
    start_line: 1,
    end_line: 38,
    snippet: "A merge to main   deploys production",
    score: 0.61,
  };
  const answer = (results = [HIT]): IcmSearchResponse => ({ query: "q", results, searched: [], skipped: [] });

  test("asks the API and maps its hits to citable icm: paths, without downloading anything", async () => {
    const client = fakeClient({ release: R1, files: FILES });
    client.icmSearch.mockResolvedValue(answer());
    const hits = await new IcmCorpus(client, { cacheDir, log }).search({ query: "how is it deployed", maxResults: 50 });
    expect(hits).toEqual([
      {
        corpus: "icm",
        path: "icm:api/_shared/deploy.md",
        title: "Deploy",
        kind: "icm-file",
        score: 0.61,
        snippet: "A merge to main deploys production",
        citation: "icm:api/_shared/deploy.md#L1-L38",
        provenanceLabel: "ICM MemoryRelay API",
        sourceType: "icm",
        startLine: 1,
        endLine: 38,
      },
    ]);
    expect(client.icmSearch).toHaveBeenCalledWith({ query: "how is it deployed", workspaceIds: undefined, limit: 20 });
  });

  test("configured workspaces become ids; none readable means no call", async () => {
    const client = fakeClient({ release: R1, files: FILES });
    client.icmSearch.mockResolvedValue(answer([]));
    await new IcmCorpus(client, { cacheDir, log, workspaces: ["api", "ws-3"] }).search({ query: "deploy" });
    expect((client.icmSearch.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]).toMatchObject({ workspaceIds: ["ws-1", "ws-3"] });
    const none = fakeClient({ release: R1, files: FILES });
    expect(await new IcmCorpus(none, { cacheDir, log, workspaces: ["nope"] }).search({ query: "deploy" })).toEqual([]);
    expect(none.icmSearch).not.toHaveBeenCalled();
  });

  test("a 404 switches to the local copy for good; another failure only for that call", async () => {
    const client = fakeClient({ release: R1, files: FILES });
    const corpus = new IcmCorpus(client, { cacheDir, log });
    expect((await corpus.search({ query: "rollback" }))[0].path).toBe("icm:api/_shared/deploy.md");
    await corpus.search({ query: "rollback" });
    expect(client.icmSearch).toHaveBeenCalledTimes(1);

    const flaky = fakeClient({ release: R1, files: FILES });
    flaky.icmSearch.mockRejectedValueOnce(new IcmApiError(503, "unavailable", "down")).mockResolvedValue(answer());
    const c2 = new IcmCorpus(flaky, { cacheDir, log });
    expect((await c2.search({ query: "rollback" }))[0].citation).toBe("icm:api/_shared/deploy.md#L3-L5");
    expect(log.warn).toHaveBeenCalled();
    expect((await c2.search({ query: "rollback" }))[0].citation).toBe("icm:api/_shared/deploy.md#L1-L38");
  });

  test("a sandboxed session or an empty query asks nothing", async () => {
    const client = fakeClient({ release: R1, files: FILES });
    const corpus = new IcmCorpus(client, { cacheDir, log });
    expect(await corpus.search({ query: "deploy", sandboxed: true })).toEqual([]);
    expect(await corpus.search({ query: "  the  " })).toEqual([]);
    expect(client.icmSearch).not.toHaveBeenCalled();
  });
});

describe("combineCorpusSupplements", () => {
  const source = (corpus: string, scores: number[], owns: string): MemoryCorpusSupplement => ({
    search: vi.fn(async () => scores.map((score, i) => ({ corpus, path: `${corpus}:${i}`, score, snippet: "" }))),
    get: vi.fn(async ({ lookup }) =>
      lookup.startsWith(owns) ? { corpus, path: lookup, content: "x", fromLine: 1, lineCount: 1 } : null,
    ),
  });

  test("merges by score and keeps maxResults", async () => {
    const both = combineCorpusSupplements([source("memoryrelay", [0.9, 0.4], "memoryrelay:"), source("icm", [0.7, 0.6], "icm:")]);
    const hits = await both.search({ query: "q", maxResults: 3 });
    expect(hits.map((h) => [h.corpus, h.score])).toEqual([
      ["memoryrelay", 0.9],
      ["icm", 0.7],
      ["icm", 0.6],
    ]);
  });

  test("a failing source does not hide the other", async () => {
    const broken: MemoryCorpusSupplement = {
      search: async () => {
        throw new Error("down");
      },
      get: async () => {
        throw new Error("down");
      },
    };
    const both = combineCorpusSupplements([broken, source("icm", [0.5], "icm:")]);
    expect(await both.search({ query: "q" })).toHaveLength(1);
    expect(await both.get({ lookup: "icm:api/x.md" })).toMatchObject({ corpus: "icm" });
  });

  test("get routes by prefix", async () => {
    const mr = source("memoryrelay", [], "memoryrelay:");
    const icm = source("icm", [], "icm:");
    const both = combineCorpusSupplements([mr, icm]);
    expect(await both.get({ lookup: "icm:api/x.md" })).toMatchObject({ corpus: "icm" });
    expect(await both.get({ lookup: "memoryrelay:1" })).toMatchObject({ corpus: "memoryrelay" });
    expect(await both.get({ lookup: "MEMORY.md" })).toBeNull();
  });
});
