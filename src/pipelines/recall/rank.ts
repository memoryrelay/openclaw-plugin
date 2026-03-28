import type { RecallStage, Memory } from "../types.js";

interface RankingConfig {
  freshnessBoost?: boolean;
  freshnessWindowHours?: number;
  importanceBoost?: boolean;
  tierBoost?: boolean;
}

export function scoreMemory(memory: Memory, similarity: number, rankingConfig: RankingConfig): number {
  let score = similarity;
  if (rankingConfig.freshnessBoost !== false) {
    const windowHours = rankingConfig.freshnessWindowHours ?? 24;
    const ageHours = (Date.now() - new Date(memory.created_at).getTime()) / 3_600_000;
    if (ageHours < windowHours) { score += 0.1 * (1 - ageHours / windowHours); }
  }
  if (rankingConfig.importanceBoost !== false && memory.importance != null) {
    score += 0.1 * memory.importance;
  }
  if (rankingConfig.tierBoost !== false && memory.tier === "hot") { score += 0.05; }
  return Math.min(score, 1.0);
}

export const recallRank: RecallStage = {
  name: "rank",
  enabled: () => true,
  execute: async (input, ctx) => {
    const limit = ctx.config.recallLimit ?? 5;
    const rankingConfig = ctx.config.ranking ?? {};
    const scoredLongTerm = (input.longTerm ?? [])
      .map(r => ({ memory: r.memory, finalScore: scoreMemory(r.memory, r.finalScore, rankingConfig) }))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);
    const scoredSession = (input.session ?? [])
      .map(r => ({ memory: r.memory, finalScore: scoreMemory(r.memory, r.finalScore, rankingConfig) }))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);
    return { action: "continue", data: { ...input, longTerm: scoredLongTerm, session: scoredSession } };
  },
};
