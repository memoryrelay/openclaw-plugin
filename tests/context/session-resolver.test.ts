// tests/context/session-resolver.test.ts
import { describe, test, expect, vi, beforeEach } from "vitest";
import { SessionResolver } from "../../src/context/session-resolver.js";
import type { MemoryRelayClient, PluginConfig, RequestContext } from "../../src/pipelines/types.js";

function mockClient(): MemoryRelayClient {
  let nextId = 1;
  return {
    search: vi.fn(),
    store: vi.fn(),
    list: vi.fn(),
    getOrCreateSession: vi.fn(async () => ({ id: `session-${nextId++}` })),
    startSession: vi.fn(async () => ({ id: `session-${nextId++}` })),
    endSession: vi.fn(async () => {}),
    getProjectContext: vi.fn(async () => ({})),
    recordDecision: vi.fn(async () => ({})),
  };
}

function requestCtx(sessionKey: string): RequestContext {
  return {
    sessionKey,
    agentId: "test-agent",
    channel: null,
    trigger: null,
    prompt: "test",
    isSubagent: false,
    parentSessionKey: null,
    namespace: "default",
    timestamp: Date.now(),
  };
}

const config: PluginConfig = { sessionTimeoutMinutes: 120 };

describe("SessionResolver", () => {
  test("creates session on first resolve", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    const entry = await resolver.resolve(requestCtx("key-1"));
    expect(entry.sessionId).toBe("session-1");
    expect(client.getOrCreateSession).toHaveBeenCalledTimes(1);
  });
  test("returns cached session on second resolve", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    await resolver.resolve(requestCtx("key-1"));
    await resolver.resolve(requestCtx("key-1"));
    expect(client.getOrCreateSession).toHaveBeenCalledTimes(1);
  });
  test("creates separate sessions for different keys", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    const entry1 = await resolver.resolve(requestCtx("key-1"));
    const entry2 = await resolver.resolve(requestCtx("key-2"));
    expect(entry1.sessionId).toBe("session-1");
    expect(entry2.sessionId).toBe("session-2");
    expect(client.getOrCreateSession).toHaveBeenCalledTimes(2);
  });
  test("deduplicates concurrent creates for same key", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    const ctx = requestCtx("key-1");
    const [entry1, entry2] = await Promise.all([
      resolver.resolve(ctx),
      resolver.resolve(ctx),
    ]);
    expect(entry1.sessionId).toBe(entry2.sessionId);
    expect(client.getOrCreateSession).toHaveBeenCalledTimes(1);
  });
  test("endSession removes from cache and calls client", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    await resolver.resolve(requestCtx("key-1"));
    await resolver.endSession("key-1");
    expect(client.endSession).toHaveBeenCalledWith("session-1", undefined);
    const entry = await resolver.resolve(requestCtx("key-1"));
    expect(entry.sessionId).toBe("session-2");
  });
  test("endSession is no-op for unknown key", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    await resolver.endSession("unknown");
    expect(client.endSession).not.toHaveBeenCalled();
  });
  test("cleanupStale removes stale entries", async () => {
    const client = mockClient();
    const shortConfig: PluginConfig = { sessionTimeoutMinutes: 0 };
    const resolver = new SessionResolver(client, shortConfig);
    await resolver.resolve(requestCtx("key-1"));
    await new Promise(r => setTimeout(r, 10));
    await resolver.cleanupStale();
    expect(client.endSession).toHaveBeenCalledWith("session-1", undefined);
  });
  test("evicts oldest entry when cache exceeds MAX_CACHE_SIZE", async () => {
    const client = mockClient();
    const resolver = new SessionResolver(client, config);
    // Fill cache to MAX_CACHE_SIZE (1000) with staggered lastActivityAt values
    // by resolving sessions sequentially so timestamps differ
    const MAX = 1000;
    for (let i = 0; i < MAX; i++) {
      await resolver.resolve(requestCtx(`key-${i}`));
    }
    // Capture the first resolved entry's sessionId before eviction
    const firstKey = "key-0";
    // Resolve one more entry to trigger eviction of the oldest (key-0 was first)
    await resolver.resolve(requestCtx("key-overflow"));
    // Resolving key-0 again should create a new session (it was evicted)
    const reResolved = await resolver.resolve(requestCtx(firstKey));
    // A new session was created (id > 1001 since we created 1001 sessions before)
    expect(reResolved.sessionId).not.toBe("session-1");
  });
});
