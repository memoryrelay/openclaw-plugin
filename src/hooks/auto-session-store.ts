// src/hooks/auto-session-store.ts
// Shared utilities for auto session lifecycle between before-agent-start and agent-end hooks.

/**
 * Build a deterministic external_id for a session from the session key and date.
 * This ensures that multiple turns within the same OpenClaw session on the same day
 * reuse a single MemoryRelay session instead of creating a new one per turn.
 */
export function buildAutoSessionExternalId(sessionKey: string, date?: Date): string {
  const day = (date ?? new Date()).toISOString().slice(0, 10);
  // Use session key + date to scope one MemoryRelay session per OpenClaw session per day.
  // If no session key is available, fall back to a date-only key (one per agent per day).
  return sessionKey ? `auto:${sessionKey}:${day}` : `auto:${day}`;
}

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
