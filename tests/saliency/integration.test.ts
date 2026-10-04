// tests/saliency/integration.test.ts
// Integration tests: realistic conversation examples for saliency scoring.
// Covers both true positives (real decisions) and false positives from the audit.

import { describe, test, expect } from "vitest";
import { computeSaliencyScore } from "../../src/saliency/scorer.js";
import type { ConversationMessage } from "../../src/pipelines/types.js";

// ============================================================================
// True positives: real decisions that SHOULD be captured
// ============================================================================

describe("true positives — real decisions", () => {
  test("database selection with rationale", () => {
    const context: ConversationMessage[] = [
      { role: "user", content: "We need to pick a database for the new service." },
      { role: "assistant", content: "Let me analyze the options. We need ACID compliance, JSON support, and good TypeScript tooling." },
      { role: "user", content: "What do you recommend?" },
    ];
    const msg = "We've decided to use PostgreSQL instead of MongoDB because we need ACID transactions and the pg driver has excellent TypeScript support.";
    const result = computeSaliencyScore(msg, context);
    expect(result.action).toBe("store_decision");
    expect(result.confidence).toBe("high");
  });

  test("framework decision with pros/cons", () => {
    const msg = `After evaluating both options:
- Pros of Next.js: SSR, great DX, Vercel integration
- Cons of Next.js: vendor lock-in, complex routing
- Pros of Remix: standards-based, simpler mental model
- Cons of Remix: smaller ecosystem

Decision: We're going with Next.js because the team has more experience with it and we need SSR.`;
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("store_decision");
    expect(result.confidence).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  test("architectural trade-off", () => {
    const context: ConversationMessage[] = [
      { role: "user", content: "Should we use microservices or a monolith?" },
      { role: "assistant", content: "Let me think about the design trade-offs for this architecture." },
    ];
    const msg = "We're going with a modular monolith rather than microservices. The trade-off is we sacrifice independent deployment, but given that our team is small, the reduced operational complexity is worth it.";
    const result = computeSaliencyScore(msg, context);
    expect(result.action).toBe("store_decision");
  });

  test("explicit decision marker with alternatives", () => {
    const msg = "Decision: We will use Docker Compose for local development instead of Kubernetes. The simplicity gain is worth sacrificing production parity because we already have CI/CD for that.";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("store_decision");
    expect(result.confidence).toBe("high");
  });

  test("choosing a testing strategy", () => {
    const msg = "We've decided to adopt integration tests over unit tests for the data layer because mocking the database gave us false confidence — the prod migration failure proved that.";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("store_decision");
  });
});

// ============================================================================
// True negatives: NON-decisions that should NOT be captured
// ============================================================================

describe("true negatives — not decisions", () => {
  test("audit false positive: 'this is an architecture problem'", () => {
    const msg = "Great question — this is a real architecture problem that we need to think carefully about.";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("ignore");
  });

  test("audit false positive: casual 'instead of' in technical note", () => {
    const msg = "Use printf instead of heredoc for the string interpolation.";
    const result = computeSaliencyScore(msg, []);
    // Should not be auto-stored as a decision
    expect(result.action).not.toBe("store_decision");
  });

  test("audit false positive: 'it won't work'", () => {
    const msg = "It won't work because the API doesn't support that format.";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).not.toBe("store_decision");
  });

  test("simple code instruction", () => {
    const msg = "Run npm install and then npm test to verify everything passes.";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("ignore");
  });

  test("bug report", () => {
    const msg = "The login page is broken. Users can't sign in because the session cookie is not being set correctly.";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("ignore");
  });

  test("question about approach", () => {
    const msg = "Should we use a queue for this? What if the message broker goes down?";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("ignore");
  });

  test("status update", () => {
    const msg = "I've fixed the bug and all 378 tests pass. The build is green.";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("ignore");
  });

  test("explaining existing code", () => {
    const msg = "This function iterates over the list and filters out items that don't match the predicate. It uses Array.filter which returns a new array.";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("ignore");
  });

  test("acknowledging user input", () => {
    const msg = "Got it, I'll make those changes. Let me update the configuration file.";
    const result = computeSaliencyScore(msg, []);
    expect(result.action).toBe("ignore");
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("edge cases", () => {
  test("decision buried in long message still detected", () => {
    const msg = `I've been reviewing the codebase and here's what I found:

The auth module needs some refactoring. There are several issues with how tokens are handled.

After analyzing the options, we've decided to switch from JWT to session-based auth because JWTs can't be revoked without a blocklist, and we need instant revocation for compliance.

I'll start implementing this in the next PR.`;
    const result = computeSaliencyScore(msg, []);
    expect(result.score).toBeGreaterThanOrEqual(40);
  });

  test("question + decision in same message: decision wins", () => {
    const msg = "Should we keep the old API? No — we've decided to deprecate v1 because maintaining two versions doubles our support burden.";
    const result = computeSaliencyScore(msg, []);
    // The explicit marker + rationale should outweigh the question penalty
    expect(result.score).toBeGreaterThanOrEqual(40);
  });

  test("empty message scores 0", () => {
    const result = computeSaliencyScore("", []);
    expect(result.score).toBe(0);
    expect(result.action).toBe("ignore");
  });

  test("very short message scores low", () => {
    const result = computeSaliencyScore("ok", []);
    expect(result.score).toBe(0);
    expect(result.action).toBe("ignore");
  });
});
