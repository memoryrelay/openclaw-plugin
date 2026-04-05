/**
 * OpenClaw Memory Plugin - MemoryRelay
 * Version: 0.19.2
 *
 * Long-term memory with vector search using MemoryRelay API.
 * Provides auto-recall and auto-capture via lifecycle hooks.
 * Includes: memories, entities, agents, sessions, decisions, patterns, projects.
 * New in v0.16.0: Modular architecture — hooks, tools, and client extracted to src/
 * New in v0.15.0: V2 async API, context_build with AI-enhanced search modes
 * New in v0.13.0: External session IDs, get-or-create sessions, multi-agent collaboration
 * New in v0.12.0: Smart auto-capture, daily stats, CLI commands, onboarding
 *
 * API: https://api.memoryrelay.net
 * Docs: https://memoryrelay.ai
 */

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
const PLUGIN_VERSION = _pkg.version;

// --- Core services ---
import { DebugLogger } from "./src/debug-logger.js";
import {
  StatusReporter,
  type AutoCaptureConfig,
  type AutoCaptureTier,
} from "./src/status-reporter.js";
import {
  MemoryRelayClient,
  DEFAULT_API_URL,
  VALID_HEALTH_STATUSES,
} from "./src/client/memoryrelay-client.js";
import { SessionResolver } from "./src/context/session-resolver.js";
import { LocalCache } from "./src/cache/local-cache.js";
import { SyncDaemon } from "./src/cache/sync-daemon.js";
import { PluginMemoryManager } from "./src/cache/memory-manager.js";
import type { LocalCacheConfig } from "./src/cache/types.js";

// --- Hooks ---
import { registerBeforeAgentStart } from "./src/hooks/before-agent-start.js";
import { registerBeforePromptBuild } from "./src/hooks/before-prompt-build.js";
import { registerAgentEnd } from "./src/hooks/agent-end.js";
import { registerSessionLifecycle } from "./src/hooks/session-lifecycle.js";
import { registerSubagentHooks } from "./src/hooks/subagent.js";
import { registerCompactionHooks } from "./src/hooks/compaction.js";
import { registerActivityHooks } from "./src/hooks/activity.js";
import { registerPrivacyHooks } from "./src/hooks/privacy.js";

// --- Tools ---
import { registerMemoryTools } from "./src/tools/memory-tools.js";
import { registerSessionTools } from "./src/tools/session-tools.js";
import { registerEntityTools } from "./src/tools/entity-tools.js";
import { registerDecisionTools } from "./src/tools/decision-tools.js";
import { registerPatternTools } from "./src/tools/pattern-tools.js";
import { registerProjectTools } from "./src/tools/project-tools.js";
import { registerAgentTools } from "./src/tools/agent-tools.js";
import { registerV2Tools } from "./src/tools/v2-tools.js";
import { registerHealthTools } from "./src/tools/health-tools.js";

// --- Heartbeat / Onboarding / CLI ---
import {
  calculateStats,
  morningCheck,
  eveningReview,
  shouldRunHeartbeat,
  formatStatsForDisplay,
  type DailyStatsConfig,
} from "./src/heartbeat/daily-stats.js";
import {
  statsCommand,
  type StatsCommandOptions,
} from "./src/cli/stats-command.js";
import {
  checkFirstRun,
  generateOnboardingPrompt,
  generateSuccessMessage,
  runSimpleOnboarding,
} from "./src/onboarding/first-run.js";

// --- Pipeline types (used for PluginConfig interface) ---
import type { PluginConfig, EmbeddingService } from "./src/pipelines/types.js";
import { ApiEmbeddingService } from "./src/cache/api-embedding-service.js";

// ============================================================================
// Config type for raw plugin JSON (superset of PluginConfig)
// ============================================================================

interface MemoryRelayConfig {
  apiKey?: string;
  agentId?: string;
  apiUrl?: string;
  autoCapture?: boolean | AutoCaptureConfig;
  autoRecall?: boolean;
  recallLimit?: number;
  recallThreshold?: number;
  excludeChannels?: string[];
  defaultProject?: string;
  enabledTools?: string;
  dailyStats?: DailyStatsConfig;
  debug?: boolean;
  verbose?: boolean;
  logFile?: string;
  maxLogEntries?: number;
  sessionTimeoutMinutes?: number;
  sessionCleanupIntervalMinutes?: number;
  maxSessionAgeHours?: number;
  idleTimeoutMinutes?: number;
  maxSessions?: number;
  warnAtPercent?: number;
  criticalAtPercent?: number;
  localCache?: Partial<LocalCacheConfig>;
}

// ============================================================================
// Auto-Capture Configuration Helpers
// ============================================================================

function normalizeAutoCaptureConfig(
  config: boolean | AutoCaptureConfig | undefined,
): AutoCaptureConfig {
  const defaultConfig: AutoCaptureConfig = {
    enabled: true,
    tier: "conservative" as AutoCaptureTier,
    confirmFirst: 5,
    categories: {
      credentials: true,
      preferences: true,
      technical: true,
      personal: false,
    },
    blocklist: [
      /password\s*[:=]\s*[^\s]+/i,
      /credit\s*card/i,
      /ssn\s*[:=]/i,
      /social\s*security/i,
    ].map((r) => r.source),
  };

  if (typeof config === "boolean") {
    return { ...defaultConfig, enabled: config };
  }
  if (config === undefined) {
    return defaultConfig;
  }
  return {
    enabled: config.enabled ?? defaultConfig.enabled,
    tier: config.tier ?? defaultConfig.tier,
    confirmFirst: config.confirmFirst ?? defaultConfig.confirmFirst,
    categories: { ...defaultConfig.categories, ...config.categories },
    blocklist: config.blocklist ?? defaultConfig.blocklist,
  };
}

// ============================================================================
// Privacy / Content helpers (used by hooks that take function refs)
// ============================================================================

function isBlocklisted(content: string, blocklist: string[]): boolean {
  return blocklist.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(content);
    } catch {
      return false;
    }
  });
}

function redactSensitive(content: string, blocklist: string[]): string {
  let redacted = content;
  for (const pattern of blocklist) {
    try {
      redacted = redacted.replace(new RegExp(pattern, "gi"), "[REDACTED]");
    } catch {
      // Invalid regex, skip
    }
  }
  return redacted;
}

function extractRescueContent(messages: unknown[], blocklist: string[]): string[] {
  const rescued: string[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    if (m.role !== "assistant") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (content.length < 200) continue;
    if (isBlocklisted(content, blocklist)) continue;
    rescued.push(content.slice(0, 500));
  }
  return rescued.slice(0, 3);
}

// ============================================================================
// Tool Groups (used by status reporting and enabledTools filter)
// ============================================================================

const TOOL_GROUPS: Record<string, string[]> = {
  memory: [
    "memory_store", "memory_recall", "memory_forget", "memory_list",
    "memory_get", "memory_update", "memory_batch_store", "memory_context",
    "memory_promote",
  ],
  entity: ["entity_create", "entity_link", "entity_list", "entity_graph"],
  agent: ["agent_list", "agent_create", "agent_get"],
  session: ["session_start", "session_end", "session_recall", "session_list"],
  decision: ["decision_record", "decision_list", "decision_supersede", "decision_check"],
  pattern: ["pattern_create", "pattern_search", "pattern_adopt", "pattern_suggest"],
  project: [
    "project_register", "project_list", "project_info",
    "project_add_relationship", "project_dependencies", "project_dependents",
    "project_related", "project_impact", "project_shared_patterns", "project_context",
  ],
  health: ["memory_health"],
  v2: ["memory_store_async", "memory_status", "context_build"],
};

// ============================================================================
// Command Argument Parser
// ============================================================================

function parseCommandArgs(input: string | undefined): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  if (!input || input.trim() === "") {
    return { positional, flags };
  }

  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positional.push(token);
      i += 1;
    }
  }

  return { positional, flags };
}

// ============================================================================
// Plugin Export
// ============================================================================

export default async function plugin(api: OpenClawPluginApi): Promise<void> {
  const cfg = api.pluginConfig as MemoryRelayConfig | undefined;

  // --- Resolve config from plugin JSON + env vars ---
  const apiKey = cfg?.apiKey || process.env.MEMORYRELAY_API_KEY;
  const agentId = cfg?.agentId || process.env.MEMORYRELAY_AGENT_ID || api.agentName;

  if (!apiKey) {
    api.logger.error(
      "memory-memoryrelay: Missing API key in config or MEMORYRELAY_API_KEY env var.\n\n" +
        "REQUIRED: Add config after installation:\n\n" +
        'cat ~/.openclaw/openclaw.json | jq \'.plugins.entries."plugin-memoryrelay-ai".config = {\n' +
        '  "apiKey": "YOUR_API_KEY",\n' +
        '  "agentId": "YOUR_AGENT_ID"\n' +
        "}' > /tmp/config.json && mv /tmp/config.json ~/.openclaw/openclaw.json\n\n" +
        "Or set environment variable:\n" +
        'export MEMORYRELAY_API_KEY="mem_prod_..."\n\n' +
        "Then restart: openclaw gateway restart\n\n" +
        "Get your API key from: https://memoryrelay.ai",
    );
    return;
  }

  if (!agentId) {
    api.logger.error("memory-memoryrelay: Missing agentId in config or MEMORYRELAY_AGENT_ID env var");
    return;
  }

  const apiUrl = cfg?.apiUrl || process.env.MEMORYRELAY_API_URL || DEFAULT_API_URL;
  const defaultProject = cfg?.defaultProject || process.env.MEMORYRELAY_DEFAULT_PROJECT;

  // --- Debug Logger & Status Reporter ---
  const debugEnabled = cfg?.debug || false;
  const verboseEnabled = cfg?.verbose || false;
  const maxLogEntries = cfg?.maxLogEntries || 100;

  let debugLogger: DebugLogger | undefined;
  if (debugEnabled) {
    debugLogger = new DebugLogger({
      enabled: true,
      verbose: verboseEnabled,
      maxEntries: maxLogEntries,
      logFile: cfg?.logFile,
    });
    api.logger.info(`memory-memoryrelay: debug mode enabled (verbose: ${verboseEnabled}, maxEntries: ${maxLogEntries})`);
  }

  const statusReporter = new StatusReporter(debugLogger);

  // --- API Client ---
  const client = new MemoryRelayClient(apiKey, agentId, apiUrl, debugLogger, statusReporter);

  // --- Auto-capture config ---
  const autoCaptureConfig = normalizeAutoCaptureConfig(cfg?.autoCapture);
  const blocklist = autoCaptureConfig.blocklist || [];

  // --- Build PluginConfig for extracted modules ---
  const pluginConfig: PluginConfig = {
    apiKey,
    agentId,
    apiUrl,
    defaultProject,
    autoRecall: cfg?.autoRecall ?? true,
    autoSessions: cfg?.autoSessions ?? true,
    recallLimit: cfg?.recallLimit ?? 3,
    recallThreshold: cfg?.recallThreshold ?? 0.65,
    excludeChannels: cfg?.excludeChannels ?? [],
    autoCapture: autoCaptureConfig,
    vectorSearch: {
      enabled: cfg?.localCache?.vectorSearch?.enabled ?? false,
      provider: cfg?.localCache?.vectorSearch?.provider ?? "none",
    },
    sessionTimeoutMinutes: cfg?.sessionTimeoutMinutes,
    sessionCleanupIntervalMinutes: cfg?.sessionCleanupIntervalMinutes,
    maxSessionAgeHours: cfg?.maxSessionAgeHours,
    idleTimeoutMinutes: cfg?.idleTimeoutMinutes,
    maxSessions: cfg?.maxSessions,
    warnAtPercent: cfg?.warnAtPercent,
    criticalAtPercent: cfg?.criticalAtPercent,
    debug: cfg?.debug,
    verbose: cfg?.verbose,
    maxLogEntries: cfg?.maxLogEntries,
    logFile: cfg?.logFile,
  };

  // --- Session Resolver ---
  const sessionResolver = new SessionResolver(client, pluginConfig);

  // --- Verify connection on startup ---
  try {
    await client.health();
    api.logger.info(`memory-memoryrelay: connected to ${apiUrl}`);
  } catch (err) {
    api.logger.error(`memory-memoryrelay: health check failed: ${String(err)}`);
  }

  // --- Local Cache + SyncDaemon (v0.17.0+) ---
  // Replaces the stub file hack from v0.16.x. LocalCache creates a real SQLite
  // database at the expected path, satisfying OpenClaw's existsSync scanner and
  // enabling local-first recall/capture pipelines.
  const DEFAULT_CACHE_CONFIG: LocalCacheConfig = {
    enabled: true,
    dbPath: "",
    syncIntervalMinutes: 5,
    maxLocalMemories: 1000,
    vectorSearch: { enabled: false, provider: "none" },
    ttl: { hot: 72, warm: 168, cold: 720 },
  };

  const localCacheConfig: LocalCacheConfig = {
    ...DEFAULT_CACHE_CONFIG,
    ...cfg?.localCache,
    vectorSearch: { ...DEFAULT_CACHE_CONFIG.vectorSearch, ...cfg?.localCache?.vectorSearch },
    ttl: { ...DEFAULT_CACHE_CONFIG.ttl, ...cfg?.localCache?.ttl },
  };

  let localCache: LocalCache | null = null;
  let syncDaemon: SyncDaemon | null = null;
  let memoryManager: PluginMemoryManager | null = null;

  if (localCacheConfig.enabled) {
    try {
      const openclawHome = process.env.OPENCLAW_HOME || join(homedir(), ".openclaw");
      const resolvedAgentId = agentId || "main";
      const storeDir = join(openclawHome, "memory");
      mkdirSync(storeDir, { recursive: true });
      const dbPath = join(storeDir, `${resolvedAgentId}.sqlite`);
      localCacheConfig.dbPath = dbPath;

      localCache = new LocalCache(dbPath, localCacheConfig);

      if (!localCache.isAvailable) {
        api.logger.warn?.(
          "memory-memoryrelay: local cache unavailable (better-sqlite3 not available). " +
          "Plugin will use API-only mode. To fix: run `npm rebuild better-sqlite3` in the plugin directory.",
        );
        localCache = null;
      } else {
        syncDaemon = new SyncDaemon(localCache, client, localCacheConfig);
        syncDaemon.start();

        const vectorAvailable = localCacheConfig.vectorSearch.enabled;
        memoryManager = new PluginMemoryManager(
          localCache,
          syncDaemon,
          localCacheConfig,
          vectorAvailable,
          agentId || "main",
        );

        // Initial pull on startup (non-blocking)
        syncDaemon.pull().catch((err) =>
          api.logger.warn?.(`memory-memoryrelay: initial sync failed: ${String(err)}`),
        );

        api.logger.info?.(`memory-memoryrelay: local cache initialized at ${dbPath}`);
      }
    } catch (err) {
      api.logger.warn?.(`memory-memoryrelay: local cache init failed, falling back to API-only: ${String(err)}`);
      localCache = null;
      syncDaemon = null;
      memoryManager = null;
    }
  }

  // --- Embedding service (for hybrid vector search in recall pipeline) ---
  // Use ApiEmbeddingService (server-side embeddings via POST /v1/embed) when
  // vectorSearch is enabled. Falls back gracefully to FTS5-only if the API
  // endpoint is unavailable. Replace with NomicEmbeddingProvider for local
  // inference once that is bundled.
  const embeddingService: EmbeddingService | undefined =
    pluginConfig.vectorSearch?.enabled ? new ApiEmbeddingService(client) : undefined;

  // --- Tool enablement filter ---
  const enabledToolNames: Set<string> | null = (() => {
    if (!cfg?.enabledTools) return null;
    const groups = cfg.enabledTools.split(",").map((s) => s.trim().toLowerCase());
    if (groups.includes("all")) return null;
    const enabled = new Set<string>();
    for (const group of groups) {
      const tools = TOOL_GROUPS[group];
      if (tools) {
        for (const tool of tools) {
          enabled.add(tool);
        }
      }
    }
    return enabled;
  })();

  function isToolEnabled(name: string): boolean {
    if (!enabledToolNames) return true;
    return enabledToolNames.has(name);
  }

  // ========================================================================
  // Register Hooks (8 modules)
  // ========================================================================

  registerBeforeAgentStart(api, pluginConfig, client, isToolEnabled, defaultProject, agentId);
  registerBeforePromptBuild(api, pluginConfig, client, sessionResolver, localCache, syncDaemon, embeddingService);
  registerAgentEnd(api, pluginConfig, client, sessionResolver, localCache, syncDaemon);
  registerSessionLifecycle(api, pluginConfig, client, agentId, defaultProject, sessionResolver);
  registerSubagentHooks(api, pluginConfig, client, agentId, autoCaptureConfig, isBlocklisted);
  registerCompactionHooks(api, client, agentId, blocklist, extractRescueContent);
  registerActivityHooks(api, sessionResolver, debugLogger);
  registerPrivacyHooks(api, blocklist, isBlocklisted, redactSensitive);

  // ========================================================================
  // Register Tools (9 modules, 42 tools total)
  // ========================================================================

  registerMemoryTools(api, pluginConfig, client, sessionResolver, isToolEnabled);
  registerSessionTools(api, pluginConfig, client, sessionResolver, isToolEnabled);
  registerEntityTools(api, pluginConfig, client, isToolEnabled);
  registerDecisionTools(api, pluginConfig, client, isToolEnabled);
  registerPatternTools(api, pluginConfig, client, isToolEnabled);
  registerProjectTools(api, pluginConfig, client, isToolEnabled);
  registerAgentTools(api, pluginConfig, client, isToolEnabled);
  registerV2Tools(api, pluginConfig, client, isToolEnabled);
  registerHealthTools(api, pluginConfig, client, isToolEnabled);

  // ========================================================================
  // Startup log
  // ========================================================================

  api.logger.info?.(
    `memory-memoryrelay: plugin v${PLUGIN_VERSION} loaded (${Object.values(TOOL_GROUPS).flat().length} tools, autoRecall: ${pluginConfig.autoRecall}, autoCapture: ${autoCaptureConfig.enabled ? autoCaptureConfig.tier : "off"}, debug: ${debugEnabled})`,
  );

  // ========================================================================
  // First-Run Onboarding
  // ========================================================================

  try {
    const onboardingCheck = await checkFirstRun(async () => {
      const memories = await client.list(1);
      return memories.length;
    });

    if (onboardingCheck.shouldOnboard) {
      await runSimpleOnboarding(
        async (content, metadata) => {
          const memory = await client.store(content, metadata || {});
          return { id: memory.id };
        },
        "Welcome to MemoryRelay! This is your first memory. Use memory_store to add more.",
        autoCaptureConfig.enabled,
      );

      const successMsg = generateSuccessMessage(
        "Welcome to MemoryRelay! This is your first memory.",
        autoCaptureConfig.enabled,
      );

      api.logger.info?.(`\n${successMsg}`);
    }
  } catch (err) {
    api.logger.warn?.(`memory-memoryrelay: onboarding check failed: ${String(err)}`);
  }

  // ========================================================================
  // Gateway Methods (memory.probe, memory.status, memoryrelay.*)
  // ========================================================================

  // memory.probe — returns MemoryProviderStatus-compatible data so
  // `openclaw status` shows memory count, vector info, and provider details
  // instead of "unavailable". OpenClaw 2026.3.28+ calls this for all memory plugins.
  api.registerGatewayMethod?.("memory.probe", async ({ respond }) => {
    // Use local PluginMemoryManager when available (v0.17.0+)
    if (memoryManager) {
      try {
        const stats = memoryManager.cacheStats();
        const daemonInfo = memoryManager.getSyncDaemonInfo();
        respond(true, {
          available: true,
          provider: "memoryrelay",
          memoryCount: stats.totalMemories,
          tierBreakdown: stats.tierBreakdown,
          bufferDepth: stats.bufferDepth,
          syncActive: daemonInfo.running,
          lastSync: stats.lastSync,
          vector: { enabled: localCacheConfig.vectorSearch.enabled, dims: 768 },
          fts: { enabled: true },
          consecutiveErrors: daemonInfo.errors,
        });
        return;
      } catch (err) {
        api.logger.warn?.(`memory-memoryrelay: memory.probe local cache failed, falling back to API: ${String(err)}`);
      }
    }

    try {
      const health = await client.health() as { status: string; embedding_info?: { dimension?: number } };
      const healthStatus = String(health.status).toLowerCase();
      const isConnected = VALID_HEALTH_STATUSES.includes(healthStatus);

      let memoryCount = 0;
      try {
        const stats = await client.stats();
        memoryCount = stats.total_memories;
      } catch (_) {
        // stats endpoint may be unavailable
      }

      const dims = health.embedding_info?.dimension ?? 768;

      respond(true, {
        available: isConnected,
        provider: "memoryrelay",
        backend: "builtin",
        files: memoryCount,
        chunks: memoryCount,
        dirty: false,
        vector: { enabled: true, available: true, dims },
        fts: { enabled: false, available: false },
        custom: { endpoint: apiUrl, agentId, tier: "remote" },
      });
    } catch (_err) {
      respond(true, {
        available: false,
        provider: "memoryrelay",
        backend: "builtin",
        files: 0,
        chunks: 0,
        dirty: false,
        vector: { enabled: true, available: false, dims: 768 },
        fts: { enabled: false, available: false },
        error: String(_err),
        custom: { endpoint: apiUrl, agentId, tier: "remote" },
      });
    }
  });

  // getMemorySearchManager — exposes the PluginMemoryManager so OpenClaw's
  // status scanner can call status(), probeVectorAvailability(), and close().
  api.registerGatewayMethod?.("getMemorySearchManager", async ({ respond }) => {
    if (memoryManager) {
      respond(true, { manager: memoryManager });
    } else {
      respond(false, { error: "Local cache not initialized" });
    }
  });

  api.registerGatewayMethod?.("memory.status", async ({ respond }) => {
    try {
      const startTime = Date.now();
      const health = await client.health();
      const responseTime = Date.now() - startTime;

      const healthStatus = String(health.status).toLowerCase();
      const isConnected = VALID_HEALTH_STATUSES.includes(healthStatus);

      const connectionStatus = {
        status: isConnected ? "connected" as const : "disconnected" as const,
        endpoint: apiUrl,
        lastCheck: new Date().toISOString(),
        responseTime,
      };

      let memoryCount = 0;
      try {
        const stats = await client.stats();
        memoryCount = stats.total_memories;
      } catch (_) {
        // stats endpoint may be unavailable
      }

      const memoryStats = { total_memories: memoryCount };

      const reportConfig = {
        agentId: agentId,
        autoRecall: pluginConfig.autoRecall ?? true,
        autoCapture: autoCaptureConfig,
        recallLimit: pluginConfig.recallLimit ?? 5,
        recallThreshold: pluginConfig.recallThreshold ?? 0.3,
        excludeChannels: pluginConfig.excludeChannels ?? [],
        defaultProject,
      };

      if (statusReporter) {
        const report = statusReporter.buildReport(connectionStatus, reportConfig, memoryStats, TOOL_GROUPS);
        const formatted = StatusReporter.formatReport(report);
        api.logger.info(formatted);
        respond(true, {
          available: true,
          connected: isConnected,
          endpoint: apiUrl,
          memoryCount,
          agentId,
          debug: debugEnabled,
          verbose: verboseEnabled,
          report,
          vector: { available: true, enabled: true },
        });
      } else {
        respond(true, {
          available: true,
          connected: isConnected,
          endpoint: apiUrl,
          memoryCount,
          agentId,
          vector: { available: true, enabled: true },
        });
      }
    } catch (err) {
      respond(true, {
        available: false,
        connected: false,
        error: String(err),
        endpoint: apiUrl,
        agentId,
        vector: { available: false, enabled: true },
      });
    }
  });

  if (debugLogger) {
    api.registerGatewayMethod?.("memoryrelay.logs", async ({ respond, args }) => {
      try {
        const limit = args?.limit || 20;
        const toolName = args?.tool;
        const errorsOnly = args?.errorsOnly || false;

        let logs;
        if (toolName) {
          logs = debugLogger.getToolLogs(toolName, limit);
        } else if (errorsOnly) {
          logs = debugLogger.getErrorLogs(limit);
        } else {
          logs = debugLogger.getRecentLogs(limit);
        }

        const formatted = logs
          .map(
            (l) =>
              `[${new Date(l.timestamp).toISOString()}] ${l.status.toUpperCase()} ${l.tool ?? "-"}: ${l.method} ${l.path} (${l.duration}ms)${l.error ? ` - ${l.error}` : ""}`,
          )
          .join("\n");
        respond(true, { logs, formatted, count: logs.length });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });
  }

  api.registerGatewayMethod?.("memoryrelay.health", async ({ respond }) => {
    try {
      const startTime = Date.now();
      const health = await client.health();
      const healthDuration = Date.now() - startTime;

      const results: any = {
        api: { status: health.status, endpoint: apiUrl, responseTime: healthDuration, reachable: true },
        authentication: { status: "valid", apiKey: apiKey.substring(0, 16) + "..." },
        tools: {},
      };

      const toolTests = [
        { name: "memory_store", test: async () => { const m = await client.store("Plugin health check test", { test: "true" }); await client.delete(m.id); return { success: true }; } },
        { name: "memory_recall", test: async () => { await client.search("test", 1, 0.5); return { success: true }; } },
        { name: "memory_list", test: async () => { await client.list(1); return { success: true }; } },
      ];

      for (const { name, test } of toolTests) {
        const testStart = Date.now();
        try {
          await test();
          results.tools[name] = { status: "working", duration: Date.now() - testStart };
        } catch (err) {
          results.tools[name] = { status: "error", error: String(err), duration: Date.now() - testStart };
        }
      }

      const allToolsWorking = Object.values(results.tools).every((t: any) => t.status === "working");
      results.overall = allToolsWorking ? "healthy" : "degraded";
      respond(true, results);
    } catch (err) {
      respond(false, { overall: "unhealthy", error: String(err) });
    }
  });

  if (debugLogger) {
    api.registerGatewayMethod?.("memoryrelay.metrics", async ({ respond }) => {
      try {
        const stats = debugLogger.getStats();
        const allLogs = debugLogger.getAllLogs();

        const toolMetrics: Record<string, any> = {};
        for (const log of allLogs) {
          if (!toolMetrics[log.tool]) {
            toolMetrics[log.tool] = { calls: 0, successes: 0, failures: 0, totalDuration: 0, durations: [] as number[] };
          }
          const metric = toolMetrics[log.tool];
          metric.calls++;
          if (log.status === "success") metric.successes++;
          else metric.failures++;
          metric.totalDuration += log.duration;
          metric.durations.push(log.duration);
        }

        for (const tool in toolMetrics) {
          const metric = toolMetrics[tool];
          metric.avgDuration = Math.round(metric.totalDuration / metric.calls);
          metric.successRate = Math.round((metric.successes / metric.calls) * 100);
          const sorted = metric.durations.sort((a: number, b: number) => a - b);
          metric.p95Duration = sorted[Math.floor(sorted.length * 0.95)] || 0;
          metric.p99Duration = sorted[Math.floor(sorted.length * 0.99)] || 0;
          delete metric.durations;
        }

        respond(true, { summary: stats, toolMetrics });
      } catch (err) {
        respond(false, { error: String(err) });
      }
    });
  }

  api.registerGatewayMethod?.("memoryrelay.heartbeat", async ({ respond }) => {
    try {
      const dailyStatsConfig: DailyStatsConfig = {
        enabled: cfg?.dailyStats?.enabled ?? true,
        morningTime: cfg?.dailyStats?.morningTime || "09:00",
        eveningTime: cfg?.dailyStats?.eveningTime || "20:00",
      };

      const heartbeatType = shouldRunHeartbeat(dailyStatsConfig);
      if (!heartbeatType) {
        respond(true, { type: "none", message: "Not scheduled for heartbeat check right now" });
        return;
      }

      const memories = await client.list(1000);
      const stats = await calculateStats(async () => memories, () => 0);

      let result;
      if (heartbeatType === "morning") {
        result = await morningCheck(stats);
      } else {
        result = await eveningReview(stats);
      }

      respond(true, { type: heartbeatType, shouldNotify: result.shouldNotify, message: result.message, stats: result.stats });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod?.("memoryrelay.onboarding", async ({ respond }) => {
    try {
      const onboardingCheck2 = await checkFirstRun(async () => {
        const memories = await client.list(1);
        return memories.length;
      });
      const prompt = generateOnboardingPrompt();
      respond(true, {
        isFirstRun: onboardingCheck2.isFirstRun,
        alreadyOnboarded: onboardingCheck2.state?.completed || false,
        prompt,
      });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod?.("memoryrelay.stats", async ({ respond, args }) => {
    try {
      const options: StatsCommandOptions = {
        format: (args?.format as "text" | "json") || "text",
        verbose: Boolean(args?.verbose),
      };
      const memories = await client.list(1000);
      const output = await statsCommand(async () => memories, options);
      respond(true, { output, format: options.format });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  api.registerGatewayMethod?.("memoryrelay.test", async ({ respond, args }) => {
    try {
      const toolName = args?.tool;
      if (!toolName) { respond(false, { error: "Missing required argument: tool" }); return; }

      const startTime = Date.now();
      let result: any;
      let error: string | undefined;

      try {
        switch (toolName) {
          case "memory_store": {
            const mem = await client.store("Test memory", { test: "true" });
            await client.delete(mem.id);
            result = { success: true, message: "Memory stored and deleted successfully" };
            break;
          }
          case "memory_recall": {
            const searchResults = await client.search("test", 1, 0.5);
            result = { success: true, results: searchResults.length, message: "Search completed" };
            break;
          }
          case "memory_list": {
            const list = await client.list(5);
            result = { success: true, count: list.length, message: "List retrieved" };
            break;
          }
          case "project_list": {
            const projects = await client.listProjects(5);
            result = { success: true, count: projects.length, message: "Projects listed" };
            break;
          }
          case "memory_health": {
            const h = await client.health();
            result = { success: true, status: h.status, message: "Health check passed" };
            break;
          }
          default:
            result = { success: false, message: `Unknown tool: ${toolName}` };
        }
      } catch (err2) {
        error = String(err2);
        result = { success: false, error };
      }

      respond(true, { tool: toolName, duration: Date.now() - startTime, result, error });
    } catch (err) {
      respond(false, { error: String(err) });
    }
  });

  // ========================================================================
  // CLI Commands (17 total)
  // ========================================================================

  api.registerCommand?.({
    name: "memory-status",
    description: "Show MemoryRelay connection status, tool counts, and memory stats",
    requireAuth: true,
    handler: async (_ctx) => {
      try {
        const startTime = Date.now();
        const healthResult = await client.health();
        const responseTime = Date.now() - startTime;
        const healthStatus = String(healthResult.status).toLowerCase();
        const isConnected = VALID_HEALTH_STATUSES.includes(healthStatus);

        const connectionStatus = {
          status: isConnected ? "connected" as const : "disconnected" as const,
          endpoint: apiUrl,
          lastCheck: new Date().toISOString(),
          responseTime,
        };

        let memoryCount = 0;
        try { const s = await client.stats(); memoryCount = s.total_memories; } catch (_) {}

        const reportConfig = {
          agentId,
          autoRecall: pluginConfig.autoRecall ?? true,
          autoCapture: autoCaptureConfig,
          recallLimit: pluginConfig.recallLimit ?? 5,
          recallThreshold: pluginConfig.recallThreshold ?? 0.3,
          excludeChannels: pluginConfig.excludeChannels ?? [],
          defaultProject,
        };

        if (statusReporter) {
          const report = statusReporter.buildReport(connectionStatus, reportConfig, { total_memories: memoryCount }, TOOL_GROUPS);
          let text = StatusReporter.formatReport(report);

          // Append local cache section when available
          if (memoryManager) {
            try {
              const cacheStats = memoryManager.cacheStats();
              const daemonInfo = memoryManager.getSyncDaemonInfo();
              const cacheLines: string[] = [];
              cacheLines.push("LOCAL CACHE");
              const { hot, warm, cold } = cacheStats.tierBreakdown;
              cacheLines.push(`  Total:     ${cacheStats.totalMemories} memories (hot: ${hot}, warm: ${warm}, cold: ${cold})`);
              cacheLines.push(`  Buffer:    ${cacheStats.bufferDepth} entries pending sync`);
              if (cacheStats.lastSync) {
                const ago = StatusReporter.formatTimeAgo(new Date(cacheStats.lastSync));
                cacheLines.push(`  Last sync: ${ago}`);
              } else {
                cacheLines.push("  Last sync: never");
              }
              const vecLabel = localCacheConfig.vectorSearch.enabled ? "ready (sqlite-vec, 768 dims)" : "disabled";
              cacheLines.push(`  Vector:    ${vecLabel}`);
              cacheLines.push("  FTS:       ready");
              cacheLines.push("");
              const daemonStatus = daemonInfo.running ? "running" : "stopped";
              cacheLines.push(`SYNC DAEMON: ${daemonStatus}`);
              cacheLines.push(`  Interval:  ${daemonInfo.intervalMinutes} minutes`);
              cacheLines.push(`  Errors:    ${daemonInfo.errors} consecutive`);
              if (daemonInfo.lastError) {
                cacheLines.push(`  Last error: ${daemonInfo.lastError}`);
              }
              cacheLines.push("");
              text += cacheLines.join("\n");
            } catch {
              // cache stats unavailable — skip section
            }
          }

          return { text };
        }
        return { text: `MemoryRelay: ${isConnected ? "connected" : "disconnected"} | Endpoint: ${apiUrl} | Memories: ${memoryCount} | Agent: ${agentId}` };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-stats",
    description: "Show daily memory statistics (total, today, weekly growth, top categories)",
    requireAuth: true,
    handler: async (_ctx) => {
      try {
        const memories = await client.list(1000);
        const stats = await calculateStats(async () => memories, () => 0);
        return { text: formatStatsForDisplay(stats) };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-health",
    description: "Check MemoryRelay API health and response time",
    requireAuth: true,
    handler: async (_ctx) => {
      try {
        const startTime = Date.now();
        const healthResult = await client.health();
        const responseTime = Date.now() - startTime;
        const healthStatus = String(healthResult.status).toLowerCase();
        const isHealthy = VALID_HEALTH_STATUSES.includes(healthStatus);
        const symbol = isHealthy ? "OK" : "DEGRADED";
        return { text: `MemoryRelay Health: ${symbol}\n  Status:        ${healthResult.status}\n  Response Time: ${responseTime}ms\n  Endpoint:      ${apiUrl}` };
      } catch (err) {
        return { text: `MemoryRelay Health: UNREACHABLE\n  Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-logs",
    description: "Show recent MemoryRelay debug log entries",
    requireAuth: true,
    handler: async (_ctx) => {
      try {
        if (!debugLogger) return { text: "Debug logging is disabled. Enable it with debug: true in plugin config." };
        const logs = debugLogger.getRecentLogs(10);
        if (logs.length === 0) return { text: "No recent log entries." };
        const lines: string[] = ["Recent MemoryRelay Logs", "\u2501".repeat(50)];
        for (const entry of logs) {
          const statusSymbol = entry.status === "success" ? "OK" : "ERR";
          lines.push(`[${entry.timestamp}] ${statusSymbol} ${entry.method} ${entry.path} (${entry.duration}ms)${entry.error ? ` - ${entry.error}` : ""}`);
        }
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-metrics",
    description: "Show per-tool call counts, success rates, and latency metrics",
    requireAuth: true,
    handler: async (_ctx) => {
      try {
        if (!debugLogger) return { text: "Debug logging is disabled. Enable it with debug: true in plugin config." };
        const allLogs = debugLogger.getAllLogs();
        if (allLogs.length === 0) return { text: "No metrics data available yet." };

        const toolMetrics = new Map<string, { calls: number; successes: number; durations: number[] }>();
        for (const entry of allLogs) {
          let metrics = toolMetrics.get(entry.tool);
          if (!metrics) { metrics = { calls: 0, successes: 0, durations: [] }; toolMetrics.set(entry.tool, metrics); }
          metrics.calls++;
          if (entry.status === "success") metrics.successes++;
          metrics.durations.push(entry.duration);
        }

        const lines: string[] = [
          "MemoryRelay Tool Metrics",
          "\u2501".repeat(65),
          `${"Tool".padEnd(22)} ${"Calls".padStart(6)} ${"Success%".padStart(9)} ${"Avg(ms)".padStart(8)} ${"P95(ms)".padStart(8)}`,
          "\u2500".repeat(65),
        ];

        for (const [tool, m] of Array.from(toolMetrics.entries()).sort((a, b) => b[1].calls - a[1].calls)) {
          const successRate = m.calls > 0 ? ((m.successes / m.calls) * 100).toFixed(1) : "0.0";
          const avg = m.durations.length > 0 ? Math.round(m.durations.reduce((s, d) => s + d, 0) / m.durations.length) : 0;
          const sorted = [...m.durations].sort((a, b) => a - b);
          const p95idx = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
          const p95 = sorted.length > 0 ? sorted[Math.max(0, p95idx)] : 0;
          lines.push(`${tool.padEnd(22)} ${String(m.calls).padStart(6)} ${(successRate + "%").padStart(9)} ${String(avg).padStart(8)} ${String(p95).padStart(8)}`);
        }

        lines.push("\u2500".repeat(65));
        lines.push(`Total entries: ${allLogs.length}`);
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-search",
    description: "Semantic search across stored memories",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx) => {
      try {
        const { positional, flags } = parseCommandArgs(ctx.args);
        const query = positional[0];
        if (!query) return { text: "Usage: /memory-search <query> [--limit 10] [--project slug] [--threshold 0.3]" };
        const limit = flags["limit"] ? parseInt(String(flags["limit"]), 10) : 10;
        const threshold = flags["threshold"] ? parseFloat(String(flags["threshold"])) : 0.3;
        const project = flags["project"] ? String(flags["project"]) : undefined;

        const results = await client.search(query, limit, threshold, { project });
        const items: unknown[] = Array.isArray(results) ? results : (results as { data?: unknown[] }).data ?? [];
        if (items.length === 0) return { text: `No memories found for: "${query}"` };

        const lines: string[] = [`Memory Search: "${query}"`, "\u2501".repeat(60)];
        for (const item of items) {
          const m = item as Record<string, unknown>;
          const content = String(m["content"] ?? "").slice(0, 120);
          const score = typeof m["similarity"] === "number" ? `${Math.round(m["similarity"] as number * 100)}%` : "N/A";
          const category = String(m["category"] ?? "general");
          const date = m["created_at"] ? new Date(String(m["created_at"])).toLocaleDateString() : "unknown";
          const id = String(m["id"] ?? "");
          lines.push(`[${score}] ${content}`);
          lines.push(`  Category: ${category} | Date: ${date} | ID: ${id}`);
        }
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-validate",
    description: "Run production readiness checks for the MemoryRelay plugin",
    requireAuth: true,
    handler: async (_ctx) => {
      try {
        const results: Array<{ label: string; status: "PASS" | "FAIL" | "WARN"; detail: string }> = [];

        try { await client.health(); results.push({ label: "API connectivity", status: "PASS", detail: "Health endpoint reachable" }); }
        catch (err) { results.push({ label: "API connectivity", status: "FAIL", detail: String(err) }); }

        try {
          const h = await client.health();
          const s = String(h.status).toLowerCase();
          results.push(VALID_HEALTH_STATUSES.includes(s)
            ? { label: "API health", status: "PASS", detail: `Status: ${h.status}` }
            : { label: "API health", status: "WARN", detail: `Unexpected status: ${h.status}` });
        } catch (err) { results.push({ label: "API health", status: "FAIL", detail: String(err) }); }

        const allTools = Object.values(TOOL_GROUPS).flat();
        const coreTools = ["memory_store", "memory_recall", "memory_list"];
        const missing = coreTools.filter((t) => !allTools.includes(t));
        results.push(missing.length === 0
          ? { label: "Core tools", status: "PASS", detail: "memory_store, memory_recall, memory_list present" }
          : { label: "Core tools", status: "FAIL", detail: `Missing: ${missing.join(", ")}` });

        const autoRecall = pluginConfig.autoRecall ?? true;
        results.push({ label: "Auto-recall enabled", status: autoRecall ? "PASS" : "WARN", detail: autoRecall ? "Enabled" : "Disabled in config" });
        results.push({ label: "Auto-capture enabled", status: autoCaptureConfig.enabled ? "PASS" : "WARN", detail: autoCaptureConfig.enabled ? `Enabled (tier: ${autoCaptureConfig.tier})` : "Disabled in config" });

        try { await client.list(1); results.push({ label: "Memory storage", status: "PASS", detail: "Storage accessible" }); }
        catch (err) { results.push({ label: "Memory storage", status: "FAIL", detail: String(err) }); }

        const agentIdOk = agentId && agentId !== "" && agentId !== "default";
        results.push({ label: "Agent ID configured", status: agentIdOk ? "PASS" : "WARN", detail: agentIdOk ? `ID: ${agentId}` : `Agent ID is "${agentId}" -- consider setting a unique ID` });

        const passes = results.filter((r) => r.status === "PASS").length;
        const failures = results.filter((r) => r.status === "FAIL").length;
        let grade: string;
        if (passes === 7) grade = "A+"; else if (passes === 6) grade = "A"; else if (passes === 5) grade = "B+"; else if (passes === 4) grade = "B"; else grade = "F";

        const lines: string[] = ["MemoryRelay Production Readiness", "\u2501".repeat(50)];
        for (const r of results) lines.push(`[${r.status.padEnd(4)}] ${r.label}: ${r.detail}`);
        lines.push("\u2500".repeat(50));
        lines.push(`Checks passed: ${passes}/7 | Grade: ${grade} | Production ready: ${failures === 0 ? "Yes" : "No"}`);
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-config",
    description: "Display current MemoryRelay plugin configuration",
    requireAuth: true,
    handler: async (_ctx) => {
      try {
        const lines: string[] = ["MemoryRelay Configuration", "\u2501".repeat(50)];
        lines.push(`API URL:             ${apiUrl}`);
        lines.push(`Agent ID:            ${agentId}`);
        lines.push(`Default Project:     ${defaultProject || "(none)"}`);
        lines.push(`Enabled Tools:       ${cfg?.enabledTools ?? "all"}`);
        lines.push(`Auto-Recall:         ${pluginConfig.autoRecall ?? true}`);
        lines.push(`Auto-Capture:        ${autoCaptureConfig.enabled} (tier: ${autoCaptureConfig.tier})`);
        lines.push(`Recall Limit:        ${pluginConfig.recallLimit ?? 5}`);
        lines.push(`Recall Threshold:    ${pluginConfig.recallThreshold ?? 0.3}`);
        lines.push(`Exclude Channels:    ${(pluginConfig.excludeChannels ?? []).join(", ") || "(none)"}`);
        lines.push(`Session Timeout:     ${cfg?.sessionTimeoutMinutes ?? 120} min`);
        lines.push(`Cleanup Interval:    ${cfg?.sessionCleanupIntervalMinutes ?? 30} min`);
        lines.push(`Debug:               ${cfg?.debug ?? false}`);
        lines.push(`Verbose:             ${cfg?.verbose ?? false}`);
        lines.push(`Max Log Entries:     ${cfg?.maxLogEntries ?? 100}`);
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-sessions",
    description: "List MemoryRelay sessions",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx) => {
      try {
        const { flags } = parseCommandArgs(ctx.args);
        const limit = flags["limit"] ? parseInt(String(flags["limit"]), 10) : 10;
        const project = flags["project"] ? String(flags["project"]) : undefined;
        let status: string | undefined = flags["status"] ? String(flags["status"]) : undefined;
        if (flags["active"]) status = "active";

        const raw = await client.listSessions(limit, project, status);
        const sessions: unknown[] = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];
        if (sessions.length === 0) return { text: "No sessions found." };

        const lines: string[] = ["MemoryRelay Sessions", "\u2501".repeat(60)];
        for (const session of sessions) {
          const s = session as Record<string, unknown>;
          const sid = String(s["id"] ?? "");
          const sessionStatus = String(s["status"] ?? "unknown").toUpperCase();
          const startedAt = s["started_at"] ? new Date(String(s["started_at"])).toLocaleString() : "unknown";
          let duration = "ongoing";
          if (s["started_at"] && s["ended_at"]) {
            const diffMs = new Date(String(s["ended_at"])).getTime() - new Date(String(s["started_at"])).getTime();
            duration = `${Math.round(diffMs / 60000)}m`;
          }
          const summary = String(s["summary"] ?? "").slice(0, 80);
          lines.push(`[${sessionStatus}] ${sid}`);
          lines.push(`  Started: ${startedAt} | Duration: ${duration}`);
          if (summary) lines.push(`  ${summary}`);
        }
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-decisions",
    description: "List architectural decisions stored in MemoryRelay",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx) => {
      try {
        const { flags } = parseCommandArgs(ctx.args);
        const limit = flags["limit"] ? parseInt(String(flags["limit"]), 10) : 10;
        const project = flags["project"] ? String(flags["project"]) : undefined;
        const status = flags["status"] ? String(flags["status"]) : undefined;
        const tags = flags["tags"] ? String(flags["tags"]) : undefined;

        const raw = await client.listDecisions(limit, project, status, tags);
        const decisions: unknown[] = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];
        if (decisions.length === 0) return { text: "No decisions found." };

        const lines: string[] = ["MemoryRelay Decisions", "\u2501".repeat(60)];
        for (const decision of decisions) {
          const d = decision as Record<string, unknown>;
          const decisionStatus = String(d["status"] ?? "unknown").toUpperCase();
          const title = String(d["title"] ?? "(untitled)");
          const date = d["created_at"] ? new Date(String(d["created_at"])).toLocaleDateString() : "unknown";
          const rationale = String(d["rationale"] ?? "").slice(0, 100);
          lines.push(`[${decisionStatus}] ${title} (${date})`);
          if (rationale) lines.push(`  ${rationale}`);
        }
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-patterns",
    description: "List or search memory patterns",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx) => {
      try {
        const { positional, flags } = parseCommandArgs(ctx.args);
        const query = positional[0] ?? "";
        const limit = flags["limit"] ? parseInt(String(flags["limit"]), 10) : 10;
        const category = flags["category"] ? String(flags["category"]) : undefined;
        const project = flags["project"] ? String(flags["project"]) : undefined;

        const raw = await client.searchPatterns(query, category, project, limit);
        const patterns: unknown[] = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];
        if (patterns.length === 0) return { text: query ? `No patterns found for: "${query}"` : "No patterns found." };

        const lines: string[] = ["MemoryRelay Patterns", "\u2501".repeat(60)];
        for (const pattern of patterns) {
          const p = pattern as Record<string, unknown>;
          lines.push(`${String(p["name"] ?? "(unnamed)")} [${String(p["category"] ?? "general")}]`);
          const desc = String(p["description"] ?? "").slice(0, 100);
          if (desc) lines.push(`  ${desc}`);
        }
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-entities",
    description: "List entities stored in MemoryRelay",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx) => {
      try {
        const { flags } = parseCommandArgs(ctx.args);
        const limit = flags["limit"] ? parseInt(String(flags["limit"]), 10) : 20;
        const raw = await client.listEntities(limit);
        const entities: unknown[] = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];
        if (entities.length === 0) return { text: "No entities found." };

        const lines: string[] = ["MemoryRelay Entities", "\u2501".repeat(60)];
        for (const entity of entities) {
          const e = entity as Record<string, unknown>;
          const name = String(e["name"] ?? "(unnamed)");
          const type = String(e["type"] ?? "unknown");
          const relationships = Array.isArray(e["relationships"]) ? e["relationships"].length : (typeof e["relationship_count"] === "number" ? e["relationship_count"] : 0);
          lines.push(`${name} [${type}] (${relationships} relationships)`);
        }
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-projects",
    description: "List projects in MemoryRelay",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx) => {
      try {
        const { flags } = parseCommandArgs(ctx.args);
        const limit = flags["limit"] ? parseInt(String(flags["limit"]), 10) : 20;
        const raw = await client.listProjects(limit);
        const projects: unknown[] = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];
        if (projects.length === 0) return { text: "No projects found." };

        const lines: string[] = ["MemoryRelay Projects", "\u2501".repeat(60)];
        for (const project of projects) {
          const p = project as Record<string, unknown>;
          const slug = String(p["slug"] ?? "(no-slug)");
          const description = String(p["description"] ?? "").slice(0, 80);
          const memoryCount = typeof p["memory_count"] === "number" ? p["memory_count"] : 0;
          lines.push(`${slug} -- ${description || "(no description)"} (${memoryCount} memories)`);
        }
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-agents",
    description: "List agents registered in MemoryRelay",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx) => {
      try {
        const { flags } = parseCommandArgs(ctx.args);
        const limit = flags["limit"] ? parseInt(String(flags["limit"]), 10) : 20;
        const raw = await client.listAgents(limit);
        const agents: unknown[] = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];
        if (agents.length === 0) return { text: "No agents found." };

        const lines: string[] = ["MemoryRelay Agents", "\u2501".repeat(60)];
        for (const agent of agents) {
          const a = agent as Record<string, unknown>;
          const id = String(a["id"] ?? "(no-id)");
          const name = String(a["name"] ?? "");
          const description = String(a["description"] ?? "");
          lines.push(`${id}${name ? ` (${name})` : ""}${description ? `, ${description}` : ""}`);
        }
        return { text: lines.join("\n") };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-forget",
    description: "Delete a specific memory by ID",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx) => {
      const { positional } = parseCommandArgs(ctx.args);
      const memoryId = positional[0];
      if (!memoryId) return { text: "Usage: /memory-forget <memory-id>" };
      try {
        let preview = "";
        try { const existing = await client.get(memoryId); preview = String((existing as Record<string, unknown>)["content"] ?? "").slice(0, 120); } catch (_) {}
        await client.delete(memoryId);
        const lines = [`Memory deleted: ${memoryId}`];
        if (preview) lines.push(`Content: ${preview}`);
        return { text: lines.join("\n") };
      } catch (err) {
        const msg = String(err);
        if (msg.toLowerCase().includes("not found") || msg.includes("404")) return { text: `Memory not found: ${memoryId}`, isError: true };
        return { text: `Error: ${msg}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-context",
    description: "Build a ranked context bundle from memories for a given query",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx) => {
      const { positional, flags } = parseCommandArgs(ctx.args);
      const query = positional.join(" ").trim();
      if (!query) {
        return {
          text: [
            "Usage: /memory-context <query> [options]",
            "",
            "Options:",
            "  --max-memories <n>    Maximum memories to include (1-100)",
            "  --max-tokens <n>      Maximum tokens for context (100-128000)",
            "  --ai-enhanced         Generate an AI summary of memories",
            "  --search-mode <mode>  Search strategy: semantic, hybrid, keyword",
          ].join("\n"),
        };
      }
      try {
        const options: { maxMemories?: number; maxTokens?: number; aiEnhanced?: boolean; searchMode?: "semantic" | "hybrid" | "keyword" } = {};
        if (flags["max-memories"]) options.maxMemories = parseInt(String(flags["max-memories"]), 10);
        if (flags["max-tokens"]) options.maxTokens = parseInt(String(flags["max-tokens"]), 10);
        if (flags["ai-enhanced"] === true) options.aiEnhanced = true;
        if (flags["search-mode"]) options.searchMode = String(flags["search-mode"]) as "semantic" | "hybrid" | "keyword";

        const context = await client.buildContextV2(query, options);
        if (!context || (Array.isArray(context.memories) && context.memories.length === 0)) {
          return { text: `No memories found for query: "${query}"` };
        }
        return { text: JSON.stringify(context, null, 2) };
      } catch (err) {
        return { text: `Error: ${String(err)}`, isError: true };
      }
    },
  });

  api.registerCommand?.({
    name: "memory-update",
    description: "Show how to update the MemoryRelay plugin to the latest version",
    requireAuth: true,
    handler: async (_ctx) => {
      const currentVersion = PLUGIN_VERSION;
      return {
        text: [
          "MemoryRelay Plugin Update",
          "\u2501".repeat(50),
          `Current version: ${currentVersion}`,
          "",
          "To update to the latest version, run:",
          "",
          "  openclaw plugins update plugin-memoryrelay-ai",
          "",
          "Then restart the gateway:",
          "",
          "  openclaw restart",
          "",
          "Note: The plugin ID is 'plugin-memoryrelay-ai'",
          "(not 'memory-memoryrelay').",
        ].join("\n"),
      };
    },
  });

  // ========================================================================
  // Local Cache Cleanup Service
  // ========================================================================

  if (localCache || syncDaemon) {
    api.registerService({
      id: "memoryrelay-cache-cleanup",
      stop: async () => {
        syncDaemon?.stop();
        localCache?.close();
      },
    });
  }

  // ========================================================================
  // Stale Session Cleanup Service
  // ========================================================================

  const sessionCleanupIntervalMs =
    ((cfg?.sessionCleanupIntervalMinutes as number) || 30) * 60 * 1000;

  let sessionCleanupInterval: ReturnType<typeof setInterval> | null = null;

  api.registerService({
    id: "memoryrelay-session-cleanup",
    start: async (_ctx) => {
      sessionCleanupInterval = setInterval(async () => {
        try {
          await sessionResolver.cleanupStale();
        } catch (err) {
          api.logger.warn?.(`memory-memoryrelay: session cleanup failed: ${String(err)}`);
        }
      }, sessionCleanupIntervalMs);
    },
    stop: async (_ctx) => {
      if (sessionCleanupInterval) {
        clearInterval(sessionCleanupInterval);
        sessionCleanupInterval = null;
      }
    },
  });
}
