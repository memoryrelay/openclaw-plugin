/**
 * CLI Stats Command (Phase 1 - Issue #11)
 * 
 * Provides `openclaw memoryrelay stats` command for quick stats access
 * Supports both text and JSON output formats
 */

export interface StatsCommandOptions {
  format?: "text" | "json";
  verbose?: boolean;
}

export interface StatsOutput {
  total: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  weeklyGrowth: number;
  monthlyGrowth: number;
  topCategories: Array<{ category: string; count: number }>;
  recentlyAdded: Array<{
    id: string;
    content: string;
    created_at: number;
  }>;
}

/**
 * Gather comprehensive stats for CLI output
 */
export async function gatherStatsForCLI(
  getAllMemories: () => Promise<Array<{ 
    id: string;
    content: string;
    metadata: Record<string, string>;
    created_at: number;
  }>>
): Promise<StatsOutput> {
  const memories = await getAllMemories();
  const now = Date.now();
  
  // Time boundaries
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const lastWeekStart = now - 14 * 24 * 60 * 60 * 1000;
  const monthStart = now - 30 * 24 * 60 * 60 * 1000;
  const lastMonthStart = now - 60 * 24 * 60 * 60 * 1000;

  // Count by period
  const total = memories.length;
  const today = memories.filter((m) => m.created_at >= todayStart).length;
  const thisWeek = memories.filter((m) => m.created_at >= weekStart).length;
  const lastWeek = memories.filter(
    (m) => m.created_at >= lastWeekStart && m.created_at < weekStart
  ).length;
  const thisMonth = memories.filter((m) => m.created_at >= monthStart).length;
  const lastMonth = memories.filter(
    (m) => m.created_at >= lastMonthStart && m.created_at < monthStart
  ).length;

  // Growth calculations
  const weeklyGrowth = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : 0;
  const monthlyGrowth = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0;

  // Top categories
  const categoryCount = new Map<string, number>();
  for (const memory of memories) {
    const category = memory.metadata.category || "uncategorized";
    categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
  }

  const topCategories = Array.from(categoryCount.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Recently added (last 5)
  const recentlyAdded = memories
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 5)
    .map((m) => ({
      id: m.id,
      content: m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content,
      created_at: m.created_at,
    }));

  return {
    total,
    today,
    thisWeek,
    thisMonth,
    weeklyGrowth,
    monthlyGrowth,
    topCategories,
    recentlyAdded,
  };
}

/**
 * Format stats as human-readable text
 */
export function formatStatsAsText(stats: StatsOutput, verbose: boolean = false): string {
  const lines: string[] = [];
  
  lines.push("📊 MemoryRelay Statistics");
  lines.push("");
  
  // Overview
  lines.push("OVERVIEW");
  lines.push(`  Total memories: ${stats.total}`);
  lines.push(`  Added today:    ${stats.today}`);
  lines.push(`  This week:      ${stats.thisWeek} (${stats.weeklyGrowth > 0 ? '+' : ''}${stats.weeklyGrowth.toFixed(0)}%)`);
  lines.push(`  This month:     ${stats.thisMonth} (${stats.monthlyGrowth > 0 ? '+' : ''}${stats.monthlyGrowth.toFixed(0)}%)`);
  lines.push("");

  // Top categories
  if (stats.topCategories.length > 0) {
    lines.push("TOP CATEGORIES");
    const displayCount = verbose ? 10 : 5;
    for (const cat of stats.topCategories.slice(0, displayCount)) {
      const percentage = ((cat.count / stats.total) * 100).toFixed(1);
      lines.push(`  ${cat.category.padEnd(20)} ${cat.count.toString().padStart(4)} (${percentage}%)`);
    }
    lines.push("");
  }

  // Recently added (verbose only)
  if (verbose && stats.recentlyAdded.length > 0) {
    lines.push("RECENTLY ADDED");
    for (const memory of stats.recentlyAdded) {
      const date = new Date(memory.created_at).toLocaleDateString();
      lines.push(`  [${date}] ${memory.content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format stats as JSON
 */
export function formatStatsAsJSON(stats: StatsOutput): string {
  return JSON.stringify(stats, null, 2);
}

/**
 * Main CLI stats command handler
 */
export async function statsCommand(
  getAllMemories: () => Promise<Array<{ 
    id: string;
    content: string;
    metadata: Record<string, string>;
    created_at: number;
  }>>,
  options: StatsCommandOptions = {}
): Promise<string> {
  const stats = await gatherStatsForCLI(getAllMemories);
  
  if (options.format === "json") {
    return formatStatsAsJSON(stats);
  }
  
  return formatStatsAsText(stats, options.verbose);
}
