import { describe, test, expect } from "vitest";
import { formatMemories } from "../../../src/pipelines/recall/format.js";
import type { Memory } from "../../../src/pipelines/types.js";

function mem(content: string): Memory {
  return {
    id: "m1", content, agent_id: "a", user_id: "u",
    metadata: {}, entities: [],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

describe("formatMemories", () => {
  test("formats long-term only", () => {
    const result = formatMemories([mem("fact A"), mem("fact B")], [], false);
    expect(result).toContain("<long-term-memories>");
    expect(result).toContain("- fact A");
    expect(result).toContain("- fact B");
    expect(result).not.toContain("<session-memories>");
  });
  test("formats session only", () => {
    const result = formatMemories([], [mem("ctx item")], false);
    expect(result).toContain("<session-memories>");
    expect(result).toContain("- ctx item");
    expect(result).not.toContain("<long-term-memories>");
  });
  test("formats both scopes", () => {
    const result = formatMemories([mem("long")], [mem("short")], false);
    expect(result).toContain("<long-term-memories>");
    expect(result).toContain("<session-memories>");
  });
  test("prepends subagent notice", () => {
    const result = formatMemories([mem("fact")], [], true);
    expect(result).toContain("parent session");
    expect(result).toContain("context only");
  });
  test("returns empty string when no memories", () => {
    expect(formatMemories([], [], false)).toBe("");
  });
});
