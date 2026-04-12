// src/saliency/types.ts
// Types for multi-signal decision saliency scoring (issue #132).

export interface SignalMatch {
  /** Name of the signal that matched (e.g. "explicit-marker", "tradeoff-language"). */
  signal: string;
  /** Points contributed (positive or negative). */
  points: number;
  /** The text snippet that triggered the match. */
  match?: string;
}

export interface SaliencyResult {
  /** Final clamped score (0-100). */
  score: number;
  /** Confidence tier derived from thresholds. */
  confidence: "high" | "medium" | "low";
  /** Action to take based on score. */
  action: "store_decision" | "store_candidate" | "ignore";
  /** All signal matches that contributed to the score. */
  signals: SignalMatch[];
}

export interface SaliencyThresholds {
  /** Score at or above which decisions are auto-stored (default 70). */
  high: number;
  /** Score at or above which decisions are stored as candidates (default 40). */
  medium: number;
}

export interface ScorerOptions {
  thresholds?: Partial<SaliencyThresholds>;
  /** Whether to store medium-confidence detections as candidates (default true). */
  storeCandidates?: boolean;
}

export const DEFAULT_THRESHOLDS: SaliencyThresholds = {
  high: 70,
  medium: 40,
};
