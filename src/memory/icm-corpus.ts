// src/memory/icm-corpus.ts
//
// ICM workspace files as a corpus of OpenClaw's memory: memory_search(corpus=
// "all") finds sections of the files of each workspace this key can read, and
// memory_get(path="icm:<workspace>/<file>", corpus="all") reads one.
//
// The API has no full-text search over ICM files, so the plugin searches them
// itself. Each workspace's live release is fetched once as a zip (one request)
// and cached on disk under its release id; a release id names immutable
// content, so a cached release is never stale. The live channel is re-read at
// most every `refreshMs`; when it moves, the new release is fetched in the
// background and the old cache file is removed.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";
import { readZipText } from "./zip.js";
import type { CorpusGetParams, CorpusGetResult, CorpusSearchParams, CorpusSearchResult } from "./corpus-supplement.js";

export const ICM_CORPUS = "icm";
export const ICM_PATH_PREFIX = "icm:";
const EXPORT_MANIFEST = "manifest.json";
const SECTION_MAX_LINES = 40;
const SNIPPET_CHARS = 400;
const DEFAULT_REFRESH_MS = 10 * 60 * 1000;
/** How long a search waits for the very first load before answering with nothing. */
const FIRST_LOAD_WAIT_MS = 8000;
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "how", "what", "when", "where", "which",
  "who", "why", "does", "into", "about", "your", "you", "our", "its", "not", "can", "use", "any", "all",
]);

type Client = Pick<MemoryRelayClient, "icmListWorkspaces" | "icmGetChannel" | "icmExportRelease">;
type Log = { debug?: (msg: string) => void; warn?: (msg: string) => void };

interface Section {
  file: string;
  title: string;
  startLine: number;
  endLine: number;
  text: string;
  terms: Map<string, number>;
  length: number;
}

interface LoadedWorkspace {
  id: string;
  slug: string;
  name: string;
  releaseId: string;
  files: Map<string, string>;
  sections: Section[];
}

interface CachedRelease {
  workspaceId: string;
  slug: string;
  name: string;
  releaseId: string;
  files: Record<string, string>;
}

export interface IcmCorpusOptions {
  /** Workspace slugs or ids to include; every readable workspace when empty. */
  workspaces?: string[];
  cacheDir: string;
  refreshMs?: number;
  log: Log;
  now?: () => number;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

/** Split a file into heading-bounded sections of at most SECTION_MAX_LINES lines. */
export function sectionsOf(file: string, content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let start = 0;
  let title = file;
  const flush = (end: number) => {
    if (end <= start) return;
    const text = lines.slice(start, end).join("\n");
    if (!text.trim()) return;
    const terms = new Map<string, number>();
    const tokens = tokenize(`${title} ${text}`);
    for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
    sections.push({ file, title, startLine: start + 1, endLine: end, text, terms, length: tokens.length });
  };
  for (let i = 0; i < lines.length; i++) {
    const heading = /^#{1,6}\s+(.*)$/.exec(lines[i]);
    if ((heading && i > start) || i - start >= SECTION_MAX_LINES) {
      flush(i);
      start = i;
    }
    if (heading) title = heading[1].trim() || file;
  }
  flush(lines.length);
  return sections;
}

function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS - 1)}…` : flat;
}

export class IcmCorpus {
  private readonly workspaces = new Map<string, LoadedWorkspace>();
  private lastRefresh = 0;
  private refreshing: Promise<void> | null = null;
  private readonly refreshMs: number;
  private readonly now: () => number;

  constructor(
    private readonly client: Client,
    private readonly opts: IcmCorpusOptions,
  ) {
    this.refreshMs = opts.refreshMs ?? DEFAULT_REFRESH_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Re-read live channels when due; single-flight. Never throws. */
  refresh(force = false): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (!force && this.lastRefresh && this.now() - this.lastRefresh < this.refreshMs) return Promise.resolve();
    this.refreshing = this.load()
      .catch((error) => this.opts.log.warn?.(`memory-memoryrelay: ICM corpus refresh failed: ${String(error)}`))
      .finally(() => {
        this.lastRefresh = this.now();
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private wanted(ws: { id: string; slug: string }): boolean {
    const only = this.opts.workspaces?.filter(Boolean) ?? [];
    return only.length === 0 || only.includes(ws.slug) || only.includes(ws.id);
  }

  private async load(): Promise<void> {
    const listed = (await this.client.icmListWorkspaces()) as {
      workspaces?: Array<{ id: string; slug: string; name?: string; enabled?: boolean }>;
    };
    const seen = new Set<string>();
    for (const ws of listed.workspaces ?? []) {
      if (ws.enabled === false || !this.wanted(ws)) continue;
      let releaseId: string;
      try {
        releaseId = (await this.client.icmGetChannel(ws.id, "live")).release_id;
      } catch {
        continue; // no live release yet
      }
      seen.add(ws.id);
      if (this.workspaces.get(ws.id)?.releaseId === releaseId) continue;
      const files = await this.release(ws.id, ws.slug, ws.name ?? ws.slug, releaseId);
      const sections = [...files].flatMap(([path, content]) => sectionsOf(path, content));
      this.workspaces.set(ws.id, { id: ws.id, slug: ws.slug, name: ws.name ?? ws.slug, releaseId, files, sections });
      this.opts.log.debug?.(`memory-memoryrelay: ICM corpus ${ws.slug} @ ${releaseId.slice(0, 12)}: ${files.size} files`);
    }
    for (const id of [...this.workspaces.keys()]) if (!seen.has(id)) this.workspaces.delete(id);
    this.prune();
  }

  private cachePath(releaseId: string): string {
    return join(this.opts.cacheDir, `${releaseId}.json`);
  }

  private async release(workspaceId: string, slug: string, name: string, releaseId: string): Promise<Map<string, string>> {
    if (!/^[0-9a-f]{64}$/.test(releaseId)) throw new Error(`unexpected release id for ${slug}`);
    try {
      const cached = JSON.parse(readFileSync(this.cachePath(releaseId), "utf8")) as CachedRelease;
      if (cached.releaseId === releaseId) return new Map(Object.entries(cached.files));
    } catch {
      // not cached yet
    }
    const files = readZipText(await this.client.icmExportRelease(workspaceId, releaseId));
    files.delete(EXPORT_MANIFEST);
    try {
      mkdirSync(this.opts.cacheDir, { recursive: true, mode: 0o700 });
      const record: CachedRelease = { workspaceId, slug, name, releaseId, files: Object.fromEntries(files) };
      writeFileSync(this.cachePath(releaseId), JSON.stringify(record), { mode: 0o600 });
    } catch (error) {
      this.opts.log.debug?.(`memory-memoryrelay: ICM cache write failed: ${String(error)}`);
    }
    return files;
  }

  /** Drop cached releases no loaded workspace points at any more. */
  private prune(): void {
    const keep = new Set([...this.workspaces.values()].map((w) => `${w.releaseId}.json`));
    let names: string[] = [];
    try {
      names = readdirSync(this.opts.cacheDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (/^[0-9a-f]{64}\.json$/.test(name) && !keep.has(name)) rmSync(join(this.opts.cacheDir, name), { force: true });
    }
  }

  /** Wait for the first load (bounded), then kick a background refresh when due. */
  private async ready(): Promise<void> {
    const first = this.workspaces.size === 0 && !this.lastRefresh;
    const pending = this.refresh();
    if (first) await Promise.race([pending, new Promise((r) => setTimeout(r, FIRST_LOAD_WAIT_MS))]);
  }

  async search(params: CorpusSearchParams): Promise<CorpusSearchResult[]> {
    if (params.sandboxed) return [];
    const queryTerms = [...new Set(tokenize(params.query ?? ""))];
    if (queryTerms.length === 0) return [];
    await this.ready();

    const all = [...this.workspaces.values()].flatMap((w) => w.sections.map((s) => ({ w, s })));
    if (all.length === 0) return [];
    const avgLength = all.reduce((a, { s }) => a + s.length, 0) / all.length || 1;
    const df = new Map<string, number>();
    for (const t of queryTerms) df.set(t, all.filter(({ s }) => s.terms.has(t)).length);

    // BM25 over sections, then squashed into 0..1 so it sits next to the other
    // corpora's similarity scores instead of drowning them.
    const k1 = 1.2;
    const b = 0.75;
    const scored = all
      .map(({ w, s }) => {
        let score = 0;
        let matched = 0;
        for (const t of queryTerms) {
          const tf = s.terms.get(t) ?? 0;
          if (!tf) continue;
          matched++;
          const idf = Math.log(1 + (all.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
          score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * s.length) / avgLength)));
        }
        return { w, s, score: matched ? (score * matched) / queryTerms.length : 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, Math.min(Math.max(params.maxResults ?? 10, 1), 20));

    return scored.map(({ w, s, score }) => ({
      corpus: ICM_CORPUS,
      path: `${ICM_PATH_PREFIX}${w.slug}/${s.file}`,
      title: s.title,
      kind: "icm-file",
      score: score / (score + 5),
      snippet: snippetOf(s.text),
      citation: `${ICM_PATH_PREFIX}${w.slug}/${s.file}#L${s.startLine}-L${s.endLine}`,
      provenanceLabel: `ICM ${w.name}`,
      sourceType: ICM_CORPUS,
      startLine: s.startLine,
      endLine: s.endLine,
    }));
  }

  async get(params: CorpusGetParams): Promise<CorpusGetResult | null> {
    if (params.sandboxed || !params.lookup?.startsWith(ICM_PATH_PREFIX)) return null;
    const rest = params.lookup.slice(ICM_PATH_PREFIX.length).replace(/#.*$/, "");
    const slash = rest.indexOf("/");
    if (slash <= 0) return null;
    const key = rest.slice(0, slash);
    const file = rest.slice(slash + 1);
    await this.ready();
    const ws = [...this.workspaces.values()].find((w) => w.slug === key || w.id === key);
    const content = ws?.files.get(file);
    if (!ws || content === undefined) return null;
    const lines = content.split("\n");
    const fromLine = Math.max(1, params.fromLine ?? 1);
    const slice = lines.slice(fromLine - 1, params.lineCount ? fromLine - 1 + params.lineCount : undefined);
    return {
      corpus: ICM_CORPUS,
      path: `${ICM_PATH_PREFIX}${ws.slug}/${file}`,
      title: file,
      kind: "icm-file",
      content: slice.join("\n"),
      fromLine,
      lineCount: slice.length,
      provenanceLabel: `ICM ${ws.name} @ ${ws.releaseId.slice(0, 12)}`,
      sourceType: ICM_CORPUS,
    };
  }
}
