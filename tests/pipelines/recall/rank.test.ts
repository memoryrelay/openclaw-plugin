import { describe, test, expect } from "vitest";
import { scoreMemory } from "../../../src/pipelines/recall/rank.js";
import type { Memory } from "../../../src/pipelines/types.js";

function mem(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1", content: "test", agent_id: "agent", user_id: "user",
    metadata: {}, entities: [],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("scoreMemory", () => {
  test("base score equals similarity", () => {
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const score = scoreMemory(mem({ created_at: oldDate }), 0.7, {});
    expect(score).toBeCloseTo(0.7, 1);
  });
  test("adds freshness boost for recent memories", () => {
    const recentDate = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    const score = scoreMemory(mem({ created_at: recentDate }), 0.7, {});
    expect(score).toBeGreaterThan(0.79);
  });
  test("adds importance boost", () => {
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const score = scoreMemory(mem({ created_at: oldDate, importance: 1.0 }), 0.7, {});
    expect(score).toBeCloseTo(0.8, 1);
  });
  test("adds tier boost for hot", () => {
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const score = scoreMemory(mem({ created_at: oldDate, tier: "hot" }), 0.7, {});
    expect(score).toBeCloseTo(0.75, 1);
  });
  test("caps at 1.0", () => {
    const recentDate = new Date(Date.now() - 1000).toISOString();
    const score = scoreMemory(mem({ created_at: recentDate, importance: 1.0, tier: "hot" }), 0.95, {});
    expect(score).toBeLessThanOrEqual(1.0);
  });
  test("respects disabled boosts via config", () => {
    const recentDate = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    const score = scoreMemory(mem({ created_at: recentDate, importance: 1.0, tier: "hot" }), 0.7, {
      freshnessBoost: false, importanceBoost: false, tierBoost: false,
    });
    expect(score).toBeCloseTo(0.7, 1);
  });
});
