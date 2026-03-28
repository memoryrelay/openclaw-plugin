// src/filters/content-patterns.ts

const STRIP_PATTERNS = [
  { pattern: /<memoryrelay-workflow>[\s\S]*?<\/memoryrelay-workflow>/g, name: "workflow-blocks" },
  { pattern: /<relevant-memories>[\s\S]*?<\/relevant-memories>/g, name: "recall-blocks" },
  { pattern: /<compaction-summary>[\s\S]*?<\/compaction-summary>/g, name: "compaction-blocks" },
  { pattern: /<system-reminder>[\s\S]*?<\/system-reminder>/g, name: "system-reminders" },
  { pattern: /\[(?:image|file|attachment):.*?\]/g, name: "media-refs" },
  { pattern: /```[\s\S]{500,}?```/g, name: "large-code-blocks" },
];

export function stripContent(content: string): string {
  let result = content;
  for (const { pattern } of STRIP_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "");
  }
  result = result.replace(/\n{3,}/g, "\n\n").trim();
  return result;
}

export const LONG_TERM_SIGNALS = [
  /(?:always|never|prefer|don't like|my name is|i work at)/i,
  /(?:remember|important|note that|keep in mind)/i,
  /(?:api key|endpoint|server|credentials|config)/i,
  /(?:decision|chose|decided|agreed|approved)/i,
  /(?:pattern|convention|standard|rule)/i,
];

export function resolveScope(content: string): "session" | "long-term" {
  if (LONG_TERM_SIGNALS.some(p => p.test(content))) return "long-term";
  return "session";
}
