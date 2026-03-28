import type { RecallStage, Memory } from "../types.js";

export function formatMemories(longTerm: Memory[], session: Memory[], isSubagent: boolean): string {
  const sections: string[] = [];
  if (longTerm.length > 0) {
    sections.push(`<long-term-memories>\n${longTerm.map(m => `- ${m.content}`).join("\n")}\n</long-term-memories>`);
  }
  if (session.length > 0) {
    sections.push(`<session-memories>\n${session.map(m => `- ${m.content}`).join("\n")}\n</session-memories>`);
  }
  if (isSubagent && sections.length > 0) {
    sections.unshift("_These memories belong to the parent session. Use for context only._");
  }
  return sections.join("\n\n");
}

export const recallFormat: RecallStage = {
  name: "format",
  enabled: () => true,
  execute: async (input, ctx) => {
    const { isSubagent } = ctx.requestCtx;
    const longTermMemories = (input.longTerm ?? []).map(s => s.memory);
    const sessionMemories = (input.session ?? []).map(s => s.memory);
    if (longTermMemories.length === 0 && sessionMemories.length === 0) {
      return { action: "skip" };
    }
    const formatted = formatMemories(longTermMemories, sessionMemories, isSubagent);
    return { action: "continue", data: { ...input, formatted } };
  },
};
