// src/hooks/auto-session-store.ts
// Shared state between before-agent-start and agent-end hooks for auto session lifecycle.

/** Maps agent session key → MemoryRelay session ID */
export const autoSessionMap = new Map<string, string>();

/** Decision detection keywords used in agent-end heuristics */
export const DECISION_KEYWORDS = [
  "decided",
  "going with",
  "architecture",
  "we will",
  "won't",
  "instead of",
  "chosen",
];
