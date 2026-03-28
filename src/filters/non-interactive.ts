// src/filters/non-interactive.ts

export interface TriggerSignals {
  trigger: string | null;
  sessionKey: string;
  prompt: string;
}

const NON_INTERACTIVE_TRIGGERS = new Set([
  "cron", "heartbeat", "schedule", "automation", "health_check",
]);

const NON_INTERACTIVE_SESSION_PATTERNS = [
  /:cron:/,
  /:heartbeat:/,
  /:schedule:/,
  /:automation:/,
];

const EMPTY_PROMPTS = new Set([
  "HEARTBEAT_OK", "NO_REPLY", "HEALTH_CHECK", "PING",
]);

export function isNonInteractive(signals: TriggerSignals): boolean {
  if (signals.trigger && NON_INTERACTIVE_TRIGGERS.has(signals.trigger)) return true;
  if (NON_INTERACTIVE_SESSION_PATTERNS.some(p => p.test(signals.sessionKey))) return true;
  if (!signals.prompt || signals.prompt.length < 5) return true;
  if (EMPTY_PROMPTS.has(signals.prompt)) return true;
  return false;
}
