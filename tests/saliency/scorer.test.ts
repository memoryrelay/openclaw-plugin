// tests/saliency/scorer.test.ts
import { describe, test, expect } from "vitest";
import {
  computeSaliencyScore,
  extractDecisionSentence,
  hasExplicitMarker,
  hasStructuredComparison,
  hasTradeoffLanguage,
  hasRationale,
  hasAlternatives,
  isArchitecturalContext,
  isQuestion,
  isProblemOnly,
} from "../../src/saliency/scorer.js";
import type { ConversationMessage } from "../../src/pipelines/types.js";

// ============================================================================
// Individual signal detectors
// ============================================================================

describe("hasExplicitMarker", () => {
  test("detects 'Decision:' prefix", () => {
    const result = hasExplicitMarker("Decision: use PostgreSQL for the data layer.");
    expect(result).not.toBeNull();
    expect(result!.signal).toBe("explicit-marker");
    expect(result!.points).toBe(50);
  });

  test("detects 'We've decided'", () => {
    expect(hasExplicitMarker("We've decided to use Redis for caching.")).not.toBeNull();
  });

  test("detects 'We have decided'", () => {
    expect(hasExplicitMarker("We have decided on a monorepo structure.")).not.toBeNull();
  });

  test("detects 'I'm choosing'", () => {
    expect(hasExplicitMarker("I'm choosing TypeScript over JavaScript for this project.")).not.toBeNull();
  });

  test("detects 'We're going with'", () => {
    expect(hasExplicitMarker("We're going with Vitest as the test runner.")).not.toBeNull();
  });

  test("detects 'We are going with'", () => {
    expect(hasExplicitMarker("We are going with a microservices approach.")).not.toBeNull();
  });

  test("detects 'finally chosen'", () => {
    expect(hasExplicitMarker("We've finally chosen React over Vue.")).not.toBeNull();
  });

  test("detects 'we will use'", () => {
    expect(hasExplicitMarker("We will use Docker for containerization.")).not.toBeNull();
  });

  test("does NOT trigger on casual mention of 'decided'", () => {
    // 'decided' alone is not an explicit marker; it needs the full phrase
    expect(hasExplicitMarker("The team decided.")).toBeNull();
  });

  test("does NOT trigger on unrelated text", () => {
    expect(hasExplicitMarker("This is a regular code review comment.")).toBeNull();
  });
});

describe("hasStructuredComparison", () => {
  test("detects pros and cons", () => {
    const result = hasStructuredComparison("Pros: fast, simple. Cons: no type safety.");
    expect(result).not.toBeNull();
    expect(result!.signal).toBe("structured-comparison");
    expect(result!.points).toBe(40);
  });

  test("detects option lists", () => {
    expect(hasStructuredComparison("Option 1: Redis. Option 2: Memcached.")).not.toBeNull();
  });

  test("detects bullet lists with 3+ items", () => {
    const msg = "Approaches:\n- Use REST API\n- Use GraphQL\n- Use gRPC";
    expect(hasStructuredComparison(msg)).not.toBeNull();
  });

  test("does NOT trigger on short text", () => {
    expect(hasStructuredComparison("We need to pick a database.")).toBeNull();
  });
});

describe("hasTradeoffLanguage", () => {
  test("detects 'trade-off'", () => {
    const result = hasTradeoffLanguage("The trade-off is between speed and safety.");
    expect(result).not.toBeNull();
    expect(result!.points).toBe(30);
  });

  test("detects 'tradeoff' (no hyphen)", () => {
    expect(hasTradeoffLanguage("This is the main tradeoff we need to consider.")).not.toBeNull();
  });

  test("detects 'sacrificing'", () => {
    expect(hasTradeoffLanguage("We're sacrificing performance for correctness.")).not.toBeNull();
  });

  test("detects 'at the cost of'", () => {
    expect(hasTradeoffLanguage("Simplicity at the cost of flexibility.")).not.toBeNull();
  });

  test("detects 'in favor of'", () => {
    expect(hasTradeoffLanguage("Dropping Redux in favor of Zustand.")).not.toBeNull();
  });

  test("does NOT trigger on unrelated text", () => {
    expect(hasTradeoffLanguage("Let me check the logs.")).toBeNull();
  });
});

describe("hasRationale", () => {
  test("detects 'because'", () => {
    const result = hasRationale("We chose PostgreSQL because of its JSON support.");
    expect(result).not.toBeNull();
    expect(result!.points).toBe(20);
  });

  test("detects 'due to'", () => {
    expect(hasRationale("This approach was selected due to performance requirements.")).not.toBeNull();
  });

  test("detects 'given that'", () => {
    expect(hasRationale("Given that we need horizontal scaling, Kafka is the right choice.")).not.toBeNull();
  });

  test("detects 'since we'", () => {
    expect(hasRationale("Since we already use Node.js, let's stay with JavaScript.")).not.toBeNull();
  });

  test("does NOT trigger on unrelated text", () => {
    expect(hasRationale("The build passed successfully.")).toBeNull();
  });
});

describe("hasAlternatives", () => {
  test("detects 'vs'", () => {
    const result = hasAlternatives("PostgreSQL vs MySQL for our needs.");
    expect(result).not.toBeNull();
    expect(result!.points).toBe(20);
  });

  test("detects 'instead of'", () => {
    expect(hasAlternatives("Using Bun instead of Node.")).not.toBeNull();
  });

  test("detects 'rather than'", () => {
    expect(hasAlternatives("GraphQL rather than REST for the API.")).not.toBeNull();
  });

  test("detects 'compared to'", () => {
    expect(hasAlternatives("This is much faster compared to the previous approach.")).not.toBeNull();
  });

  test("does NOT trigger on unrelated text", () => {
    expect(hasAlternatives("The tests are passing now.")).toBeNull();
  });
});

describe("isArchitecturalContext", () => {
  test("detects architectural discussion with 2+ keywords", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "What architecture should we use for the API design?" },
      { role: "assistant", content: "Let me analyze the design patterns available." },
    ];
    const result = isArchitecturalContext(messages);
    expect(result).not.toBeNull();
    expect(result!.signal).toBe("architectural-context");
    expect(result!.points).toBe(10);
  });

  test("does NOT trigger on non-architectural conversation", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "Fix this typo in the README." },
      { role: "assistant", content: "Done, the typo has been corrected." },
    ];
    expect(isArchitecturalContext(messages)).toBeNull();
  });

  test("only considers last 5 messages", () => {
    const messages: ConversationMessage[] = [
      // Old messages with architecture keywords
      { role: "user", content: "Discuss the architecture and design." },
      { role: "assistant", content: "pattern analysis done." },
      // 5 recent messages without architecture keywords
      { role: "user", content: "Fix the login bug." },
      { role: "assistant", content: "Found the issue." },
      { role: "user", content: "What was wrong?" },
      { role: "assistant", content: "A null check was missing." },
      { role: "user", content: "Ok thanks" },
      { role: "assistant", content: "You're welcome." },
    ];
    // Last 5 messages don't contain architecture keywords
    expect(isArchitecturalContext(messages)).toBeNull();
  });
});

describe("isQuestion", () => {
  test("detects trailing question mark", () => {
    const result = isQuestion("Should we use Redis or Memcached?");
    expect(result).not.toBeNull();
    expect(result!.signal).toBe("question");
    expect(result!.points).toBe(-20);
  });

  test("detects 'should we' prefix", () => {
    expect(isQuestion("Should we migrate to TypeScript")).not.toBeNull();
  });

  test("detects 'what if' prefix", () => {
    expect(isQuestion("What if we used a queue instead")).not.toBeNull();
  });

  test("does NOT trigger on declarative statements", () => {
    expect(isQuestion("We've decided to use PostgreSQL.")).toBeNull();
  });
});

describe("isProblemOnly", () => {
  test("detects 'we have a problem'", () => {
    const result = isProblemOnly("We have a problem with the cache layer.");
    expect(result).not.toBeNull();
    expect(result!.signal).toBe("problem-only");
    expect(result!.points).toBe(-30);
  });

  test("detects 'this is broken'", () => {
    expect(isProblemOnly("This is broken in production.")).not.toBeNull();
  });

  test("detects 'needs to be fixed'", () => {
    expect(isProblemOnly("The auth module needs to be fixed urgently.")).not.toBeNull();
  });

  test("does NOT penalize when decision marker is also present", () => {
    // If the message also has a decision marker, problem-only penalty is suppressed
    expect(isProblemOnly("We have a problem, so we've decided to rewrite the cache layer.")).toBeNull();
  });

  test("does NOT trigger on non-problem text", () => {
    expect(isProblemOnly("The migration completed successfully.")).toBeNull();
  });
});

// ============================================================================
// Core scoring function
// ============================================================================

describe("computeSaliencyScore", () => {
  const noContext: ConversationMessage[] = [];

  test("high-confidence decision: explicit marker + rationale", () => {
    const msg = "We've decided to use PostgreSQL because of its JSON support and reliability.";
    const result = computeSaliencyScore(msg, noContext);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.confidence).toBe("high");
    expect(result.action).toBe("store_decision");
  });

  test("high-confidence decision: structured comparison + tradeoff", () => {
    const msg = "Pros: simple API, fast. Cons: no streaming. The trade-off is acceptable for our use case.";
    const result = computeSaliencyScore(msg, noContext);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.confidence).toBe("high");
    expect(result.action).toBe("store_decision");
  });

  test("medium-confidence decision: tradeoff + rationale", () => {
    const msg = "We're sacrificing some performance because the simpler approach is easier to maintain.";
    const result = computeSaliencyScore(msg, noContext);
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThan(70);
    expect(result.confidence).toBe("medium");
    expect(result.action).toBe("store_candidate");
  });

  test("low-confidence: pure question", () => {
    const msg = "Should we use Redis or Memcached for the cache layer?";
    const result = computeSaliencyScore(msg, noContext);
    expect(result.confidence).toBe("low");
    expect(result.action).toBe("ignore");
  });

  test("low-confidence: problem statement", () => {
    const msg = "We have a problem with the authentication middleware. It's broken in production.";
    const result = computeSaliencyScore(msg, noContext);
    expect(result.action).toBe("ignore");
  });

  test("false positive from issue: 'Great question — this is a real architecture problem'", () => {
    const msg = "Great question — this is a real architecture problem that we need to think carefully about.";
    const result = computeSaliencyScore(msg, noContext);
    // This was flagged as a false positive in the audit. Should NOT be stored.
    expect(result.action).toBe("ignore");
  });

  test("false positive: 'use printf instead of heredoc'", () => {
    const msg = "Use printf instead of heredoc for this string interpolation.";
    const result = computeSaliencyScore(msg, noContext);
    // Technical note, not a decision. Should be ignored or at most candidate.
    expect(result.score).toBeLessThan(70);
  });

  test("false positive: 'it won't work'", () => {
    const msg = "It won't work because the API doesn't support that format.";
    const result = computeSaliencyScore(msg, noContext);
    // Constraint description, not a decision
    expect(result.score).toBeLessThan(70);
  });

  test("score clamped to 0 when heavily negative", () => {
    const msg = "What if this is broken? Should we investigate?";
    const result = computeSaliencyScore(msg, noContext);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  test("score clamped to 100", () => {
    // Stack all positive signals
    const msg = "Decision: We've decided to go with Option 1 over Option 2. Pros: fast. Cons: complex. The trade-off is worth it because performance matters most.";
    const result = computeSaliencyScore(msg, noContext);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test("architectural context boosts score", () => {
    const context: ConversationMessage[] = [
      { role: "user", content: "How should we design the API architecture?" },
      { role: "assistant", content: "Let me analyze the design patterns." },
    ];
    const msg = "We're sacrificing flexibility because simplicity matters here.";
    const withCtx = computeSaliencyScore(msg, context);
    const withoutCtx = computeSaliencyScore(msg, noContext);
    expect(withCtx.score).toBeGreaterThan(withoutCtx.score);
  });

  test("respects custom thresholds", () => {
    const msg = "We're sacrificing some performance because the simpler approach is easier.";
    const strict = computeSaliencyScore(msg, noContext, { thresholds: { high: 90, medium: 60 } });
    const lenient = computeSaliencyScore(msg, noContext, { thresholds: { high: 30, medium: 10 } });
    // Same score, different confidence/action
    expect(strict.score).toBe(lenient.score);
    expect(lenient.confidence).toBe("high");
  });

  test("storeCandidates=false ignores medium-confidence", () => {
    const msg = "We're sacrificing some performance because the simpler approach is easier.";
    const result = computeSaliencyScore(msg, noContext, { storeCandidates: false });
    if (result.confidence === "medium") {
      expect(result.action).toBe("ignore");
    }
  });

  test("signals array contains all matched signals", () => {
    const msg = "Decision: We chose REST instead of GraphQL because of simplicity.";
    const result = computeSaliencyScore(msg, noContext);
    const signalNames = result.signals.map((s) => s.signal);
    expect(signalNames).toContain("explicit-marker");
    expect(signalNames).toContain("alternatives");
    expect(signalNames).toContain("rationale");
  });
});

// ============================================================================
// Sentence extraction
// ============================================================================

describe("extractDecisionSentence", () => {
  test("prefers sentence containing signal match", () => {
    const msg = "Let me analyze this. Decision: we will use PostgreSQL. That should work well.";
    const signals = [{ signal: "explicit-marker", points: 50, match: "Decision:" }];
    const sentence = extractDecisionSentence(msg, signals);
    expect(sentence).toContain("Decision:");
    expect(sentence).toContain("PostgreSQL");
  });

  test("falls back to first sentence if no signal match in text", () => {
    const msg = "We analyzed the options carefully. Then we picked the best one.";
    const sentence = extractDecisionSentence(msg, []);
    expect(sentence).toContain("analyzed");
  });

  test("truncates long sentences to 200 chars", () => {
    const longSentence = "Decision: " + "a".repeat(300) + ".";
    // The sentence is >500 chars so it gets filtered out, but the full message is used as fallback
    const sentence = extractDecisionSentence(longSentence, [{ signal: "explicit-marker", points: 50, match: "Decision:" }]);
    expect(sentence.length).toBeLessThanOrEqual(200);
  });
});
