// tests/filters/non-interactive.test.ts
import { describe, test, expect } from "vitest";
import { isNonInteractive, type TriggerSignals } from "../../src/filters/non-interactive.js";

function signals(overrides: Partial<TriggerSignals> = {}): TriggerSignals {
  return {
    trigger: null,
    sessionKey: "agent:main:abc123",
    prompt: "How do I configure the database?",
    ...overrides,
  };
}

describe("isNonInteractive", () => {
  test("returns false for normal interactive prompt", () => {
    expect(isNonInteractive(signals())).toBe(false);
  });
  test("returns true for cron trigger", () => {
    expect(isNonInteractive(signals({ trigger: "cron" }))).toBe(true);
  });
  test("returns true for heartbeat trigger", () => {
    expect(isNonInteractive(signals({ trigger: "heartbeat" }))).toBe(true);
  });
  test("returns true for schedule trigger", () => {
    expect(isNonInteractive(signals({ trigger: "schedule" }))).toBe(true);
  });
  test("returns true for automation trigger", () => {
    expect(isNonInteractive(signals({ trigger: "automation" }))).toBe(true);
  });
  test("returns true for health_check trigger", () => {
    expect(isNonInteractive(signals({ trigger: "health_check" }))).toBe(true);
  });
  test("returns true for session key with :cron: pattern", () => {
    expect(isNonInteractive(signals({ sessionKey: "agent:main:cron:daily" }))).toBe(true);
  });
  test("returns true for session key with :heartbeat: pattern", () => {
    expect(isNonInteractive(signals({ sessionKey: "system:heartbeat:check" }))).toBe(true);
  });
  test("returns true for session key with :schedule: pattern", () => {
    expect(isNonInteractive(signals({ sessionKey: "agent:main:schedule:nightly" }))).toBe(true);
  });
  test("returns true for session key with :automation: pattern", () => {
    expect(isNonInteractive(signals({ sessionKey: "ci:automation:deploy" }))).toBe(true);
  });
  test("returns true for empty prompt", () => {
    expect(isNonInteractive(signals({ prompt: "" }))).toBe(true);
  });
  test("returns true for very short prompt (< 5 chars)", () => {
    expect(isNonInteractive(signals({ prompt: "hi" }))).toBe(true);
  });
  test("returns true for HEARTBEAT_OK prompt", () => {
    expect(isNonInteractive(signals({ prompt: "HEARTBEAT_OK" }))).toBe(true);
  });
  test("returns true for NO_REPLY prompt", () => {
    expect(isNonInteractive(signals({ prompt: "NO_REPLY" }))).toBe(true);
  });
  test("returns true for HEALTH_CHECK prompt", () => {
    expect(isNonInteractive(signals({ prompt: "HEALTH_CHECK" }))).toBe(true);
  });
  test("returns true for PING prompt", () => {
    expect(isNonInteractive(signals({ prompt: "PING" }))).toBe(true);
  });
  test("returns false for short but valid prompt (>= 5 chars)", () => {
    expect(isNonInteractive(signals({ prompt: "help?" }))).toBe(false);
  });
  test("returns false for unknown trigger type", () => {
    expect(isNonInteractive(signals({ trigger: "user_message" }))).toBe(false);
  });
});
