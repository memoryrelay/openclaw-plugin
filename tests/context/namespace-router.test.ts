// tests/context/namespace-router.test.ts
import { describe, test, expect } from "vitest";
import { resolveNamespace, type NamespaceConfig } from "../../src/context/namespace-router.js";

describe("resolveNamespace", () => {
  test("returns 'default' when isolateAgents is false", () => {
    expect(resolveNamespace("agent-1", { isolateAgents: false, subagentPolicy: "inherit" })).toBe("default");
  });
  test("returns 'default' when agentId is null", () => {
    expect(resolveNamespace(null, { isolateAgents: true, subagentPolicy: "inherit" })).toBe("default");
  });
  test("returns agent namespace when isolateAgents is true and agentId set", () => {
    expect(resolveNamespace("agent-1", { isolateAgents: true, subagentPolicy: "inherit" })).toBe("agent:agent-1");
  });
  test("uses defaults when config is undefined", () => {
    expect(resolveNamespace("agent-1", undefined)).toBe("default");
  });
});
