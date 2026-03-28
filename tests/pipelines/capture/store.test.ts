import { describe, test, expect, vi } from "vitest";
import { captureStore } from "../../../src/pipelines/capture/store.js";
import type { PipelineContext, CaptureInput, SessionResolverLike } from "../../../src/pipelines/types.js";

function ctx(tierOverride?: string, sessionResolver?: SessionResolverLike): PipelineContext {
  return {
    requestCtx: {
      sessionKey: "s1", agentId: "a1", channel: null, trigger: null,
      prompt: "test", isSubagent: false, parentSessionKey: null,
      namespace: "default", timestamp: Date.now(),
    },
    config: tierOverride !== undefined
      ? { autoCapture: { enabled: true, tier: tierOverride } } as any
      : {} as any,
    client: {
      search: vi.fn(), list: vi.fn(), getOrCreateSession: vi.fn(), endSession: vi.fn(),
      store: vi.fn(async (content: string) => ({
        id: "mem-new", content, agent_id: "a1", user_id: "u1",
        metadata: {}, entities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })),
    },
    sessionResolver,
  };
}

describe("captureStore", () => {
  test("stores messages with resolved scope", async () => {
    const pctx = ctx();
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "I always prefer dark mode for my IDE" },
        { role: "user", content: "The error is on line 42 of the config file" },
      ],
    };
    const result = await captureStore.execute(input, pctx);
    expect(result.action).toBe("continue");
    expect(pctx.client.store).toHaveBeenCalledTimes(2);
    const firstCall = (pctx.client.store as any).mock.calls[0];
    expect(firstCall[0]).toContain("dark mode");
    const secondCall = (pctx.client.store as any).mock.calls[1];
    expect(secondCall[0]).toContain("line 42");
  });
  test("caps at 3 stored memories per capture (smart default)", async () => {
    const pctx = ctx();
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "I always use TypeScript for new projects" },
        { role: "user", content: "Remember that the deploy needs approval" },
        { role: "user", content: "The API endpoint is api.example.com" },
        { role: "user", content: "I decided to use PostgreSQL for this" },
        { role: "user", content: "The convention is to use kebab-case" },
      ],
    };
    await captureStore.execute(input, pctx);
    expect(pctx.client.store).toHaveBeenCalledTimes(3);
  });
  test("conservative tier caps at 1 stored memory", async () => {
    const pctx = ctx("conservative");
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "I always use TypeScript for new projects" },
        { role: "user", content: "Remember that the deploy needs approval" },
        { role: "user", content: "The API endpoint is api.example.com" },
      ],
    };
    await captureStore.execute(input, pctx);
    expect(pctx.client.store).toHaveBeenCalledTimes(1);
  });
  test("aggressive tier caps at 5 stored memories", async () => {
    const pctx = ctx("aggressive");
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "Memory 1" },
        { role: "user", content: "Memory 2" },
        { role: "user", content: "Memory 3" },
        { role: "user", content: "Memory 4" },
        { role: "user", content: "Memory 5" },
        { role: "user", content: "Memory 6" },
        { role: "user", content: "Memory 7" },
      ],
    };
    await captureStore.execute(input, pctx);
    expect(pctx.client.store).toHaveBeenCalledTimes(5);
  });
  test("smart tier explicitly caps at 3", async () => {
    const pctx = ctx("smart");
    const input: CaptureInput = {
      messages: [
        { role: "user", content: "Memory 1" },
        { role: "user", content: "Memory 2" },
        { role: "user", content: "Memory 3" },
        { role: "user", content: "Memory 4" },
        { role: "user", content: "Memory 5" },
      ],
    };
    await captureStore.execute(input, pctx);
    expect(pctx.client.store).toHaveBeenCalledTimes(3);
  });

  test("includes session_id for session-scoped memories when sessionResolver is present", async () => {
    const resolver: SessionResolverLike = {
      resolve: vi.fn(async () => ({ sessionId: "uuid-sess-42", externalId: "s1" })),
    };
    const pctx = ctx(undefined, resolver);
    // Content with no long-term signal words resolves to session scope
    const input: CaptureInput = {
      messages: [{ role: "user", content: "Let me check the build output for errors" }],
    };
    await captureStore.execute(input, pctx);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    const storeCall = (pctx.client.store as any).mock.calls[0];
    // Third arg is the options object
    expect(storeCall[2]).toEqual(expect.objectContaining({ scope: "session", session_id: "uuid-sess-42" }));
  });

  test("omits session_id for long-term scoped memories even with sessionResolver", async () => {
    const resolver: SessionResolverLike = {
      resolve: vi.fn(async () => ({ sessionId: "uuid-sess-42", externalId: "s1" })),
    };
    const pctx = ctx(undefined, resolver);
    // "I always prefer dark mode" triggers long-term signal
    const input: CaptureInput = {
      messages: [{ role: "user", content: "I always prefer dark mode for my IDE" }],
    };
    await captureStore.execute(input, pctx);
    const storeCall = (pctx.client.store as any).mock.calls[0];
    expect(storeCall[2]).toEqual(expect.objectContaining({ scope: "long-term" }));
    expect(storeCall[2]).not.toHaveProperty("session_id");
  });

  test("stores without session_id when sessionResolver is absent", async () => {
    const pctx = ctx();
    // Content with no long-term signal words resolves to session scope
    const input: CaptureInput = {
      messages: [{ role: "user", content: "Let me check the build output for errors" }],
    };
    await captureStore.execute(input, pctx);
    const storeCall = (pctx.client.store as any).mock.calls[0];
    expect(storeCall[2]).toEqual(expect.objectContaining({ scope: "session" }));
    expect(storeCall[2]).not.toHaveProperty("session_id");
  });

  test("continues without session_id when sessionResolver throws", async () => {
    const resolver: SessionResolverLike = {
      resolve: vi.fn(async () => { throw new Error("resolver down"); }),
    };
    const pctx = ctx(undefined, resolver);
    // Content with no long-term signal words resolves to session scope
    const input: CaptureInput = {
      messages: [{ role: "user", content: "Let me check the build output for errors" }],
    };
    await captureStore.execute(input, pctx);
    const storeCall = (pctx.client.store as any).mock.calls[0];
    expect(storeCall[2]).toEqual(expect.objectContaining({ scope: "session" }));
    expect(storeCall[2]).not.toHaveProperty("session_id");
  });
});
