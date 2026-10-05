// src/memory/memory-md-sync.ts
//
// MEMORY.md write-back: the agent's long-term memory file, which memory-core
// keeps (and dreaming appends to), mirrored into MemoryRelay so other agents
// and machines can recall it.
//
// One memory per heading section, keyed by its heading path ("Infrastructure ›
// NorthRelay Production"), and one per dreaming promotion, keyed by the
// promotion marker memory-core writes above it
// (`<!-- openclaw-memory-promotion:<key> -->`). A local state file maps each
// key to its content hash and MemoryRelay id, so a sync sends only what
// changed: new keys are stored, changed ones updated, vanished ones deleted.
//
// The file is the source of truth and MemoryRelay a mirror: a memory this sync
// created is deleted when its section leaves the file. Nothing else in
// MemoryRelay is touched. Secrets are redacted before anything is sent.

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { MemoryRelayClient } from "../client/memoryrelay-client.js";

type Log = { debug?: (msg: string) => void; info?: (msg: string) => void; warn?: (msg: string) => void };
type Client = Pick<MemoryRelayClient, "store" | "update" | "delete">;

export const SOURCE_SECTION = "memory-md";
export const SOURCE_PROMOTION = "dreaming";
const MAX_CONTENT_CHARS = 20_000;
const LOCK_STALE_MS = 10 * 60 * 1000;
const PROMOTION_MARKER = /^<!--\s*openclaw-memory-promotion:\s*([^\s>]+?)\s*-->\s*$/i;
const HTML_COMMENT = /^<!--.*-->\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** Credentials that must never leave the machine, whatever the blocklist says. */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:mem|imk)_[A-Za-z0-9_]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}/g, // Telegram bot token
  /\b(Bearer)\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
];
/** `password: x`, `api_key=x`, `token → x`: keep the label, drop the value. */
const SECRET_ASSIGNMENT =
  /\b((?:pass(?:word)?|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|token|auth)\b[^\n:=]{0,20}?\s*(?::|=|→|->)\s*)(`?)([^\s`'",;]{6,})\2/gi;

export function redactSecrets(text: string, blocklist: string[] = []): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, label?: string) =>
      typeof label === "string" && /^bearer$/i.test(label) ? `${label} [REDACTED]` : "[REDACTED]",
    );
  }
  out = out.replace(SECRET_ASSIGNMENT, (_m, label: string, quote: string) => `${label}${quote}[REDACTED]${quote}`);
  for (const pattern of blocklist) {
    try {
      out = out.replace(new RegExp(pattern, "gi"), "[REDACTED]");
    } catch {
      // an invalid user pattern is skipped, as the capture pipeline does
    }
  }
  return out;
}

export interface MemoryMdEntry {
  key: string;
  source: typeof SOURCE_SECTION | typeof SOURCE_PROMOTION;
  /** "Title › Section › Subsection"; empty for text before the first heading. */
  headingPath: string;
  content: string;
}

/**
 * Sections and promotions of a MEMORY.md, in file order. A section is the text
 * under one heading up to the next heading of any level; one with no text of
 * its own (only subsections) is skipped. A promotion is the marker comment and
 * the list item after it, taken out of its section.
 */
export function parseMemoryMd(content: string, fileLabel = "MEMORY.md"): MemoryMdEntry[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const entries: MemoryMdEntry[] = [];
  const seen = new Map<string, number>();
  const stack: Array<{ level: number; title: string }> = [];
  let body: string[] = [];
  let fence: string | null = null;

  const pathOf = () => stack.map((h) => h.title).join(" › ");
  const uniqueKey = (base: string) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} #${n}`;
  };
  const flush = () => {
    const text = body.join("\n").trim();
    body = [];
    if (!text) return;
    const headingPath = pathOf();
    entries.push({
      key: uniqueKey(`section:${headingPath}`),
      source: SOURCE_SECTION,
      headingPath,
      content: `${[fileLabel, headingPath].filter(Boolean).join(" › ")}\n\n${text}`,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opened = FENCE.exec(line);
    if (opened) fence = fence === opened[1] ? null : (fence ?? opened[1]);
    if (!fence && !opened) {
      const promotion = PROMOTION_MARKER.exec(line.trim());
      if (promotion) {
        const item: string[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].trim() && !HEADING.test(lines[j]) && !PROMOTION_MARKER.test(lines[j].trim())) {
          if (j > i + 1 && /^\s*[-*+]\s/.test(lines[j])) break;
          item.push(lines[j]);
          j++;
        }
        const text = item.join("\n").replace(/^\s*[-*+]\s+/, "").trim();
        if (text) {
          entries.push({
            key: uniqueKey(`promotion:${promotion[1]}`),
            source: SOURCE_PROMOTION,
            headingPath: pathOf(),
            content: `${fileLabel} › ${pathOf() || "Promoted"} (promoted by dreaming)\n\n${text}`,
          });
        }
        i = j - 1;
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        flush();
        const level = heading[1].length;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({ level, title: heading[2].trim() || "(untitled)" });
        continue;
      }
      if (HTML_COMMENT.test(line.trim())) continue; // memory-core's own markers
    }
    body.push(line);
  }
  flush();
  return entries;
}

interface SyncedEntry {
  id: string;
  hash: string;
}

interface SyncState {
  version: 1;
  files: Record<string, { entries: Record<string, SyncedEntry> }>;
}

export interface MemoryMdSyncOptions {
  /** MEMORY.md to mirror. */
  path: string;
  /** Where the key → id map lives (0600). */
  statePath: string;
  blocklist?: string[];
  log: Log;
}

export interface SyncResult {
  stored: number;
  updated: number;
  deleted: number;
  unchanged: number;
  failed: number;
  skipped?: string;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

export class MemoryMdSync {
  private running: Promise<SyncResult> | null = null;
  private lastFileHash: string | null = null;

  constructor(
    private readonly client: Client,
    private readonly opts: MemoryMdSyncOptions,
  ) {}

  private readState(): SyncState {
    try {
      const state = JSON.parse(readFileSync(this.opts.statePath, "utf8")) as SyncState;
      if (state.version === 1 && state.files) return state;
    } catch {
      // first run, or a damaged file: start over (store dedups nothing, but a
      // damaged state is rare and the duplicates are tagged and findable)
    }
    return { version: 1, files: {} };
  }

  private writeState(state: SyncState): void {
    mkdirSync(dirname(this.opts.statePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.opts.statePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmp, this.opts.statePath);
  }

  /** One sync across processes: the gateway and a CLI run share the state file. */
  private lock(): (() => void) | null {
    const lockPath = `${this.opts.statePath}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        closeSync(openSync(lockPath, "wx", 0o600));
        return () => rmSync(lockPath, { force: true });
      } catch {
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
            rmSync(lockPath, { force: true });
            continue;
          }
        } catch {
          continue;
        }
        return null;
      }
    }
    return null;
  }

  /** Mirror the file now; single-flight in this process. Never throws. */
  sync(): Promise<SyncResult> {
    if (this.running) return this.running;
    this.running = this.run()
      .catch((error): SyncResult => {
        this.opts.log.warn?.(`memory-memoryrelay: MEMORY.md sync failed: ${String(error)}`);
        return { stored: 0, updated: 0, deleted: 0, unchanged: 0, failed: 1 };
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async run(): Promise<SyncResult> {
    const result: SyncResult = { stored: 0, updated: 0, deleted: 0, unchanged: 0, failed: 0 };
    let raw: string;
    try {
      raw = readFileSync(this.opts.path, "utf8");
    } catch {
      return { ...result, skipped: "no file" };
    }
    const fileHash = hashOf(raw);
    if (fileHash === this.lastFileHash) return { ...result, skipped: "unchanged" };

    const release = this.lock();
    if (!release) return { ...result, skipped: "locked" };
    try {
      const state = this.readState();
      const synced = (state.files[this.opts.path] ??= { entries: {} }).entries;
      const entries = parseMemoryMd(raw, basename(this.opts.path));
      const present = new Set<string>();

      for (const entry of entries) {
        present.add(entry.key);
        const content = redactSecrets(entry.content, this.opts.blocklist).slice(0, MAX_CONTENT_CHARS);
        const hash = hashOf(content);
        const prior = synced[entry.key];
        if (prior?.hash === hash) {
          result.unchanged++;
          continue;
        }
        const metadata = {
          source: entry.source,
          memory_md_key: entry.key,
          memory_md_file: this.opts.path,
        };
        try {
          if (prior) {
            try {
              await this.client.update(prior.id, content, metadata);
              synced[entry.key] = { id: prior.id, hash };
              result.updated++;
            } catch (error) {
              if (!/\b404\b|not found/i.test(String(error))) throw error;
              const memory = await this.client.store(content, metadata, { deduplicate: false });
              synced[entry.key] = { id: memory.id, hash };
              result.stored++;
            }
          } else {
            const memory = await this.client.store(content, metadata, { deduplicate: false });
            synced[entry.key] = { id: memory.id, hash };
            result.stored++;
          }
          this.writeState(state);
        } catch (error) {
          result.failed++;
          this.opts.log.debug?.(`memory-memoryrelay: MEMORY.md sync ${entry.key}: ${String(error)}`);
        }
      }

      // A file emptied mid-write, or replaced by a stub, must not wipe the mirror.
      if (entries.length > 0) {
        for (const [key, prior] of Object.entries(synced)) {
          if (present.has(key)) continue;
          try {
            await this.client.delete(prior.id);
          } catch (error) {
            if (!/\b404\b|not found/i.test(String(error))) {
              result.failed++;
              continue;
            }
          }
          delete synced[key];
          result.deleted++;
          this.writeState(state);
        }
      }

      if (result.failed === 0) this.lastFileHash = fileHash;
      if (result.stored || result.updated || result.deleted || result.failed) {
        this.opts.log.info?.(
          `memory-memoryrelay: MEMORY.md synced to MemoryRelay (${result.stored} new, ${result.updated} updated, ${result.deleted} removed, ${result.unchanged} unchanged${result.failed ? `, ${result.failed} failed` : ""})`,
        );
      }
      return result;
    } finally {
      release();
    }
  }
}

/**
 * The MEMORY.md memory-core reads for this agent: its own workspace, else the
 * default workspace, else ~/.openclaw/workspace. The first that has the file.
 */
export function resolveMemoryMdPath(params: {
  configuredPath?: string;
  openclawConfig?: unknown;
  agentId?: string;
  openclawHome: string;
  exists: (path: string) => boolean;
}): string | undefined {
  if (params.configuredPath) return params.configuredPath;
  const agents = (params.openclawConfig as { agents?: { entries?: Record<string, { workspace?: string }>; defaults?: { workspace?: string } } } | undefined)?.agents;
  const candidates = [
    params.agentId ? agents?.entries?.[params.agentId]?.workspace : undefined,
    agents?.defaults?.workspace,
    `${params.openclawHome}/workspace`,
  ].filter((dir): dir is string => typeof dir === "string" && dir.length > 0);
  return candidates.map((dir) => `${dir.replace(/\/+$/, "")}/MEMORY.md`).find((path) => params.exists(path));
}
