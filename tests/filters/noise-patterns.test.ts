// tests/filters/noise-patterns.test.ts
import { describe, test, expect } from "vitest";
import { shouldDropMessage, isAssistantBoilerplate } from "../../src/filters/noise-patterns.js";
import type { ConversationMessage } from "../../src/pipelines/types.js";

function msg(role: "user" | "assistant", content: string): ConversationMessage {
  return { role, content };
}

describe("shouldDropMessage", () => {
  test("drops messages shorter than 10 chars", () => {
    expect(shouldDropMessage(msg("user", "ok"))).toBe(true);
    expect(shouldDropMessage(msg("user", "short"))).toBe(true);
  });
  test("drops HEARTBEAT_OK", () => {
    expect(shouldDropMessage(msg("user", "HEARTBEAT_OK"))).toBe(true);
  });
  test("drops NO_REPLY", () => {
    expect(shouldDropMessage(msg("user", "NO_REPLY"))).toBe(true);
  });
  test("drops bare timestamps", () => {
    expect(shouldDropMessage(msg("user", "2026-03-28T14:30:00Z"))).toBe(true);
  });
  test("drops single-word acks", () => {
    const acks = ["ok", "sure", "done", "yes", "no", "thanks", "got it", "yep", "nope", "k", "ty", "thx", "cool", "perfect"];
    for (const ack of acks) {
      expect(shouldDropMessage(msg("user", ack))).toBe(true);
    }
  });
  test("drops acks with trailing period", () => {
    expect(shouldDropMessage(msg("user", "ok."))).toBe(true);
    expect(shouldDropMessage(msg("user", "sure."))).toBe(true);
  });
  test("drops system-reminder blocks", () => {
    expect(shouldDropMessage(msg("system", "<system-reminder>some content</system-reminder>"))).toBe(true);
  });
  test("drops bare tool calls", () => {
    expect(shouldDropMessage(msg("assistant", "<tool_call>\n{\"name\":\"read\"}\n</tool_call>"))).toBe(true);
  });
  test("drops compaction audit logs", () => {
    expect(shouldDropMessage(msg("system", "<compaction-audit>removed 50 messages</compaction-audit>"))).toBe(true);
  });
  test("keeps normal user messages", () => {
    expect(shouldDropMessage(msg("user", "How do I configure the database connection?"))).toBe(false);
  });
  test("keeps normal assistant messages", () => {
    expect(shouldDropMessage(msg("assistant", "You can configure the database by editing the .env file with your connection string."))).toBe(false);
  });
  test("drops empty content", () => {
    expect(shouldDropMessage(msg("user", ""))).toBe(true);
  });
  test("drops whitespace-only content", () => {
    expect(shouldDropMessage(msg("user", "   \n  "))).toBe(true);
  });
});

describe("isAssistantBoilerplate", () => {
  test("returns false for user messages", () => {
    expect(isAssistantBoilerplate(msg("user", "I see what you mean"))).toBe(false);
  });
  test("returns false for long assistant messages (> 300 chars)", () => {
    const longMsg = "I see what you're asking about. " + "x".repeat(300);
    expect(isAssistantBoilerplate(msg("assistant", longMsg))).toBe(false);
  });
  test("detects short boilerplate with high signal density", () => {
    expect(isAssistantBoilerplate(msg("assistant", "I see. Let me know if you need anything else."))).toBe(true);
  });
  test("detects 'how can I help' boilerplate", () => {
    expect(isAssistantBoilerplate(msg("assistant", "Sure! How can I help you with that?"))).toBe(true);
  });
  test("detects 'happy to help' boilerplate", () => {
    expect(isAssistantBoilerplate(msg("assistant", "I'm happy to help! Is there anything else?"))).toBe(true);
  });
  test("keeps short assistant messages with real content", () => {
    expect(isAssistantBoilerplate(msg("assistant", "The config file is at /etc/app/config.yaml"))).toBe(false);
  });
  test("keeps medium assistant messages even with one signal", () => {
    expect(isAssistantBoilerplate(msg("assistant", "Sure, the database connection pool size should be set to 20 for your workload. Edit the DATABASE_POOL_SIZE env var in your .env file."))).toBe(false);
  });
});
