/**
 * Daily Memory Stats for Heartbeat (Phase 1 - Issue #10)
 * 
 * Provides morning and evening memory stat summaries for agent heartbeat checks.
 * Shows growth trends, categories, and most valuable memories.
 */

export interface DailyStatsConfig {
  enabled: boolean;
  morningTime?: string; // HH:MM format (default: "09:00")
  eveningTime?: string; // HH:MM format (default: "20:00")
  timezone?: string; // IANA timezone (default: system timezone)
}

export interface MemoryStats {
  total: number;
  today: number;
  thisWeek: number;
  weeklyGrowth: number; // Percentage change from last week
  topCategories: Array<{ category: string; count: number }>;
  mostValuable?: {
    id: string;
    content: string;
    recallCount: number;
  };
}

export interface HeartbeatResult {
  shouldNotify: boolean;
  message?: string;
  stats?: MemoryStats;
}

/**
 * Calculate memory statistics for the current period
 */
export async function calculateStats(
  getAllMemories: () => Promise<Array<{ id: string; content: string; metadata: Record<string, string>; created_at: number }>>,
  getRecallCount: (memoryId: string) => number = () => 0
): Promise<MemoryStats> {
  const memories = await getAllMemories();
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const lastWeekStart = now - 14 * 24 * 60 * 60 * 1000;

  // Count memories by period
  const total = memories.length;
  const today = memories.filter((m) => m.created_at >= todayStart).length;
  const thisWeek = memories.filter((m) => m.created_at >= weekStart).length;
  const lastWeek = memories.filter(
    (m) => m.created_at >= lastWeekStart && m.created_at < weekStart
  ).length;

  // Calculate weekly growth
  const weeklyGrowth = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : 0;

  // Top categories
  const categoryCount = new Map<string, number>();
  for (const memory of memories) {
    const category = memory.metadata.category || "uncategorized";
    categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
  }

  const topCategories = Array.from(categoryCount.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Most valuable memory (by recall count - simulated for now)
  let mostValuable: MemoryStats["mostValuable"];
  if (memories.length > 0) {
    const memoriesWithRecalls = memories.map((m) => ({
      ...m,
      recallCount: getRecallCount(m.id),
    }));
    memoriesWithRecalls.sort((a, b) => b.recallCount - a.recallCount);

    if (memoriesWithRecalls[0].recallCount > 0) {
      mostValuable = {
        id: memoriesWithRecalls[0].id,
        content: memoriesWithRecalls[0].content.slice(0, 100) + "...",
        recallCount: memoriesWithRecalls[0].recallCount,
      };
    }
  }

  return {
    total,
    today,
    thisWeek,
    weeklyGrowth,
    topCategories,
    mostValuable,
  };
}

/**
 * Morning check: Show memory stats and growth
 */
export async function morningCheck(
  stats: MemoryStats
): Promise<HeartbeatResult> {
  // Don't notify if no activity or very early in adoption
  if (stats.total < 5 && stats.today === 0) {
    return { shouldNotify: false };
  }

  // Build morning message
  const lines: string[] = [];
  lines.push("📊 Morning Memory Check");
  lines.push("");
  lines.push(`📚 Total memories: ${stats.total}`);
  
  if (stats.today > 0) {
    lines.push(`✨ Added today: ${stats.today}`);
  }
  
  if (stats.thisWeek > 0) {
    const growthIndicator = stats.weeklyGrowth > 0 ? "📈" : stats.weeklyGrowth < 0 ? "📉" : "➡️";
    lines.push(`${growthIndicator} This week: ${stats.thisWeek} (${stats.weeklyGrowth > 0 ? '+' : ''}${stats.weeklyGrowth.toFixed(0)}%)`);
  }

  if (stats.topCategories.length > 0) {
    lines.push("");
    lines.push("🏆 Top categories:");
    for (const cat of stats.topCategories.slice(0, 3)) {
      lines.push(`  • ${cat.category}: ${cat.count}`);
    }
  }

  return {
    shouldNotify: true,
    message: lines.join("\n"),
    stats,
  };
}

/**
 * Evening review: Show today's activity and most valuable memory
 */
export async function eveningReview(
  stats: MemoryStats
): Promise<HeartbeatResult> {
  // Don't notify if no activity today
  if (stats.today === 0 && !stats.mostValuable) {
    return { shouldNotify: false };
  }

  const lines: string[] = [];
  lines.push("🌙 Evening Memory Review");
  lines.push("");

  if (stats.today > 0) {
    lines.push(`✅ Stored today: ${stats.today} memories`);
  } else {
    lines.push("📝 No new memories today");
  }

  if (stats.mostValuable) {
    lines.push("");
    lines.push("💎 Most valuable memory:");
    lines.push(`  "${stats.mostValuable.content}"`);
    lines.push(`  Recalled ${stats.mostValuable.recallCount} times`);
  }

  return {
    shouldNotify: stats.today > 0 || (stats.mostValuable !== undefined),
    message: lines.join("\n"),
    stats,
  };
}

/**
 * Check if it's time for a heartbeat notification
 */
export function shouldRunHeartbeat(
  config: DailyStatsConfig,
  currentTime: Date = new Date()
): "morning" | "evening" | null {
  if (!config.enabled) return null;

  const morningTime = config.morningTime || "09:00";
  const eveningTime = config.eveningTime || "20:00";

  const [morningHour, morningMin] = morningTime.split(":").map(Number);
  const [eveningHour, eveningMin] = eveningTime.split(":").map(Number);

  const currentHour = currentTime.getHours();
  const currentMin = currentTime.getMinutes();

  // Check if within 5-minute window of morning time
  const morningStart = morningHour * 60 + morningMin;
  const morningEnd = morningStart + 5;
  const currentMinutes = currentHour * 60 + currentMin;

  if (currentMinutes >= morningStart && currentMinutes < morningEnd) {
    return "morning";
  }

  // Check if within 5-minute window of evening time
  const eveningStart = eveningHour * 60 + eveningMin;
  const eveningEnd = eveningStart + 5;

  if (currentMinutes >= eveningStart && currentMinutes < eveningEnd) {
    return "evening";
  }

  return null;
}

/**
 * Format stats for console/log output
 */
export function formatStatsForDisplay(stats: MemoryStats): string {
  const lines: string[] = [];
  lines.push(`Total: ${stats.total} | Today: ${stats.today} | Week: ${stats.thisWeek}`);
  
  if (stats.weeklyGrowth !== 0) {
    const sign = stats.weeklyGrowth > 0 ? "+" : "";
    lines.push(`Growth: ${sign}${stats.weeklyGrowth.toFixed(0)}%`);
  }

  if (stats.topCategories.length > 0) {
    const topCats = stats.topCategories
      .slice(0, 3)
      .map((c) => `${c.category}(${c.count})`)
      .join(", ");
    lines.push(`Top: ${topCats}`);
  }

  return lines.join(" | ");
}
