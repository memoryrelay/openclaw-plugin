import { describe, test, expect, vi, beforeEach } from "vitest";
import { extractDecisions, generateSessionSummary } from "../../src/hooks/agent-end.js";
import type { ConversationMessage } from "../../src/pipelines/types.js";

// ─── extractDecisions ────────────────────────────────────────────────────────
describe("extractDecisions", () => {
  test("returns empty array when no messages", () => {
    expect(extractDecisions([])).toEqual([]);
  });

  test("returns empty array for user-only messages", () => {
    const msgs: ConversationMessage[] = [
      { role: "user", content: "we decided to use PostgreSQL" },
    ];
    expect(extractDecisions(msgs)).toEqual([]);
  });

  test("detects decision keyword in assistant message", () => {
    const msgs: ConversationMessage[] = [
      { role: "user", content: "What database should we use? We need something with good scalability." },
      { role: "assistant", content: "**Decision: PostgreSQL for the database**\n\nAfter comparing PostgreSQL vs MySQL vs MongoDB:\n\nPros:\n- Better scalability than MySQL\n- ACID compliance\n- Strong ecosystem\n\nCons:\n- Slightly more complex than MySQL\n\nWe decided to go with PostgreSQL because it offers the best balance of features for our needs." },
    ];
    const decisions = extractDecisions(msgs);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0].title).toContain("PostgreSQL");
  });

  test("deduplicates identical sentences", () => {
    const msgs: ConversationMessage[] = [
      { role: "user", content: "What should we use?" },
      { role: "assistant", content: "Decision: Use Redis for caching. After evaluation, we chose Redis for its performance benefits." },
    ];
    const decisions = extractDecisions(msgs);
    // Should detect at least one decision (may detect both if different enough)
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions.length).toBeLessThanOrEqual(2);
  });

  test("caps at 5 decisions", () => {
    const content = [
      "We decided to use Redis for caching.",
      "We chose PostgreSQL for persistence.",
      "We agreed on TypeScript for the backend.",
      "The approach will be microservices architecture.",
      "We decided on Docker for containerization.",
      "We chose to use Next.js for the frontend.",
    ].join(" ");
    const msgs: ConversationMessage[] = [{ role: "assistant", content }];
    const decisions = extractDecisions(msgs);
    expect(decisions.length).toBeLessThanOrEqual(5);
  });

  test("skips sentences longer than 500 chars", () => {
    const longSentence = "We decided " + "x".repeat(510);
    const msgs: ConversationMessage[] = [{ role: "assistant", content: longSentence }];
    const decisions = extractDecisions(msgs);
    // The long sentence should be skipped
    expect(decisions).toEqual([]);
  });
});

// ─── generateSessionSummary ──────────────────────────────────────────────────
describe("generateSessionSummary", () => {
  test("returns default when no messages", () => {
    expect(generateSessionSummary([])).toBe("Session completed.");
  });

  test("returns default when no significant assistant messages", () => {
    const msgs: ConversationMessage[] = [
      { role: "assistant", content: "Ok" },
      { role: "user", content: "This is long enough but is user message" },
    ];
    expect(generateSessionSummary(msgs)).toBe("Session completed.");
  });

  test("uses last 3 assistant messages", () => {
    const msgs: ConversationMessage[] = [
      { role: "assistant", content: "First significant response with enough content here." },
      { role: "assistant", content: "Second significant response with enough content here." },
      { role: "assistant", content: "Third significant response with enough content here." },
      { role: "assistant", content: "Fourth significant response with enough content here." },
    ];
    const summary = generateSessionSummary(msgs);
    expect(summary).toContain("Second");
    expect(summary).toContain("Third");
    expect(summary).toContain("Fourth");
    expect(summary).not.toContain("First");
  });

  test("truncates to 800 chars total", () => {
    const msgs: ConversationMessage[] = [
      { role: "assistant", content: "x".repeat(500) },
      { role: "assistant", content: "y".repeat(500) },
    ];
    const summary = generateSessionSummary(msgs);
    expect(summary.length).toBeLessThanOrEqual(800);
  });
});
