// src/saliency/scorer.ts
// Multi-signal saliency scoring for decision detection (issue #132).
// Replaces naive keyword matching with confidence-based scoring.

import type { ConversationMessage } from "../pipelines/types.js";
import type { SignalMatch, SaliencyResult, SaliencyThresholds, ScorerOptions } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

/** Strong signals: explicit decision markers (+50). */
const EXPLICIT_MARKERS = [
  /\bdecision\s*:/i,
  /\bwe(?:'ve| have) decided\b/i,
  /\bi(?:'m| am) choosing\b/i,
  /\bwe(?:'re| are) going (?:to go )?with\b/i,
  /\bfinal(?:ly)? (?:chose|chosen|selected|picked)\b/i,
  /\bwe will (?:use|adopt|go with|implement)\b/i,
];

/** Strong signal: structured comparison — pros/cons, option lists (+40). */
const STRUCTURED_COMPARISON = [
  /\bpros?\b.*\bcons?\b/i,
  /\boption\s+[A-C1-3]\b.*\boption\s+[A-C1-3]\b/is,
  /(?:^|\n)\s*[-*]\s+.*(?:\n\s*[-*]\s+.*){2,}/m, // 3+ bullet list items
  /\balternative(?:s|ly)?\s*(?:\d|:)/i,
];

/** Medium signal: trade-off / sacrifice language (+30). */
const TRADEOFF_PATTERNS = [
  /\btrade-?off\b/i,
  /\bsacrific(?:e|ing)\b/i,
  /\bat the (?:cost|expense) of\b/i,
  /\bin (?:favor|favour) of\b/i,
  /\bweigh(?:ing|ed)? (?:the )?(options|trade-?offs|alternatives)\b/i,
];

/** Medium signal: rationale clauses (+20). */
const RATIONALE_PATTERNS = [
  /\bbecause\b/i,
  /\bdue to\b/i,
  /\bgiven that\b/i,
  /\bsince (?:we|it|the|this)\b/i,
  /\bthe reason (?:is|being|for)\b/i,
];

/** Medium signal: mentions multiple alternatives (+20). */
const ALTERNATIVE_PATTERNS = [
  /\bvs\.?\b/i,
  /\bversus\b/i,
  /\binstead of\b/i,
  /\brather than\b/i,
  /\bover\s+(?:using|choosing|going with)\b/i,
  /\bcompared to\b/i,
];

/** Negative signal: questions (-20). */
const QUESTION_PATTERNS = [
  /\?\s*$/m,
  /^(?:should we|what if|how about|would it|could we|shall we)\b/im,
  /^(?:what|which|how|why|where|when)\b.*\?/im,
];

/** Negative signal: problem statement without solution (-30). */
const PROBLEM_ONLY_PATTERNS = [
  /\bwe have a problem\b/i,
  /\bthis is (?:broken|failing|an issue)\b/i,
  /\bthe (?:issue|bug|problem) (?:is|here)\b/i,
  /\bnot working\b/i,
  /\bneeds? (?:to be )?fix(?:ed|ing)\b/i,
];

// ---------------------------------------------------------------------------
// Context keywords for architectural discussion detection
// ---------------------------------------------------------------------------

const ARCHITECTURE_CONTEXT_KEYWORDS = [
  "design", "architecture", "pattern", "approach", "schema",
  "migration", "refactor", "stack", "framework", "infrastructure",
  "microservice", "monolith", "api", "database", "deployment",
];

// ---------------------------------------------------------------------------
// Signal detectors
// ---------------------------------------------------------------------------

function matchPatterns(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return undefined;
}

/** Check if message has explicit decision markers. */
export function hasExplicitMarker(message: string): SignalMatch | null {
  const m = matchPatterns(message, EXPLICIT_MARKERS);
  return m ? { signal: "explicit-marker", points: 50, match: m } : null;
}

/** Check if message has structured comparison (pros/cons, option lists). */
export function hasStructuredComparison(message: string): SignalMatch | null {
  const m = matchPatterns(message, STRUCTURED_COMPARISON);
  return m ? { signal: "structured-comparison", points: 40, match: m } : null;
}

/** Check for trade-off language. */
export function hasTradeoffLanguage(message: string): SignalMatch | null {
  const m = matchPatterns(message, TRADEOFF_PATTERNS);
  return m ? { signal: "tradeoff-language", points: 30, match: m } : null;
}

/** Check for rationale clauses (because, due to, given that...). */
export function hasRationale(message: string): SignalMatch | null {
  const m = matchPatterns(message, RATIONALE_PATTERNS);
  return m ? { signal: "rationale", points: 20, match: m } : null;
}

/** Check for mentions of multiple alternatives (X vs Y, instead of). */
export function hasAlternatives(message: string): SignalMatch | null {
  const m = matchPatterns(message, ALTERNATIVE_PATTERNS);
  return m ? { signal: "alternatives", points: 20, match: m } : null;
}

/** Check if message is in an architectural discussion context. */
export function isArchitecturalContext(messages: ConversationMessage[]): SignalMatch | null {
  // Look at last 5 messages for architecture keywords
  const recent = messages.slice(-5);
  const text = recent.map((m) => m.content).join(" ").toLowerCase();
  const found = ARCHITECTURE_CONTEXT_KEYWORDS.filter((kw) => text.includes(kw));
  if (found.length >= 2) {
    return { signal: "architectural-context", points: 10, match: found.slice(0, 3).join(", ") };
  }
  return null;
}

/** Negative: message is primarily a question. */
export function isQuestion(message: string): SignalMatch | null {
  const m = matchPatterns(message, QUESTION_PATTERNS);
  return m ? { signal: "question", points: -20, match: m } : null;
}

/** Negative: message is a problem statement without proposing a solution. */
export function isProblemOnly(message: string): SignalMatch | null {
  const m = matchPatterns(message, PROBLEM_ONLY_PATTERNS);
  // Only penalize if there's no positive decision signal in the same message
  if (m && !matchPatterns(message, EXPLICIT_MARKERS) && !matchPatterns(message, TRADEOFF_PATTERNS)) {
    return { signal: "problem-only", points: -30, match: m };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core scorer
// ---------------------------------------------------------------------------

/**
 * Compute a saliency score for a single message within its conversation context.
 *
 * Scoring algorithm:
 *   Strong signals:  explicit-marker (+50), structured-comparison (+40)
 *   Medium signals:  tradeoff-language (+30), rationale (+20), alternatives (+20)
 *   Context signal:  architectural-context (+10)
 *   Negative signals: question (-20), problem-only (-30)
 *
 * Final score clamped to [0, 100].
 *
 * Thresholds:
 *   ≥70 → high confidence → auto-store
 *   40-69 → medium confidence → store as candidate
 *   <40 → low confidence → ignore
 */
export function computeSaliencyScore(
  message: string,
  context: ConversationMessage[],
  options?: ScorerOptions,
): SaliencyResult {
  const thresholds: SaliencyThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...options?.thresholds,
  };
  const storeCandidates = options?.storeCandidates ?? true;

  const signals: SignalMatch[] = [];

  // Positive signals
  const detectors = [
    hasExplicitMarker,
    hasStructuredComparison,
    hasTradeoffLanguage,
    hasRationale,
    hasAlternatives,
  ];
  for (const detect of detectors) {
    const result = detect(message);
    if (result) signals.push(result);
  }

  // Context signal (uses full conversation)
  const archCtx = isArchitecturalContext(context);
  if (archCtx) signals.push(archCtx);

  // Negative signals
  const negDetectors = [isQuestion, isProblemOnly];
  for (const detect of negDetectors) {
    const result = detect(message);
    if (result) signals.push(result);
  }

  // Sum and clamp
  const rawScore = signals.reduce((sum, s) => sum + s.points, 0);
  const score = Math.min(Math.max(rawScore, 0), 100);

  // Determine confidence and action
  let confidence: SaliencyResult["confidence"];
  let action: SaliencyResult["action"];

  if (score >= thresholds.high) {
    confidence = "high";
    action = "store_decision";
  } else if (score >= thresholds.medium) {
    confidence = "medium";
    action = storeCandidates ? "store_candidate" : "ignore";
  } else {
    confidence = "low";
    action = "ignore";
  }

  return { score, confidence, action, signals };
}

// ---------------------------------------------------------------------------
// Sentence extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract the most relevant sentence from a message for use as a decision title.
 * Prefers sentences that contain strong signal matches.
 */
export function extractDecisionSentence(message: string, signals: SignalMatch[]): string {
  const sentences = message
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && s.length <= 500);

  if (sentences.length === 0) return message.slice(0, 200);

  // Prefer sentences containing signal match text
  const matchTexts = signals
    .filter((s) => s.points > 0 && s.match)
    .map((s) => s.match!.toLowerCase());

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (matchTexts.some((mt) => lower.includes(mt))) {
      return sentence.slice(0, 200);
    }
  }

  // Fallback: first non-trivial sentence
  return sentences[0].slice(0, 200);
}
