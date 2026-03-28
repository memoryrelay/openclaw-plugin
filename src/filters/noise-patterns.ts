import type { ConversationMessage } from "../pipelines/types.js";

const DROP_PATTERNS = {
  systemTriggers: /^(HEARTBEAT_OK|NO_REPLY|HEALTH_CHECK|PING)$/,
  timestamps: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  acks: /^(ok|okay|sure|done|yes|no|thanks|thank you|got it|right|yep|nope|k|ty|thx|np|ack|fine|cool|great|perfect)\.?$/i,
  routingBlocks: /^<(?:system-reminder|routing|metadata|tool-result)>/,
  bareToolCalls: /^<tool_call>[\s\S]*<\/tool_call>$/,
  compactionLogs: /^<compaction-audit>/,
};

export function shouldDropMessage(message: ConversationMessage): boolean {
  const text = message.content.trim();
  if (text.length < 10) return true;
  return Object.values(DROP_PATTERNS).some(p => p.test(text));
}

const BOILERPLATE_SIGNALS = [
  /^(I see|I understand|Got it|Sure|Let me|I'll|I can|Here's what)/i,
  /how can I help/i,
  /let me know if/i,
  /is there anything else/i,
  /happy to help/i,
];

export function isAssistantBoilerplate(message: ConversationMessage): boolean {
  if (message.role !== "assistant") return false;
  const text = message.content.trim();
  if (text.length > 300) return false;
  const signalCount = BOILERPLATE_SIGNALS.filter(p => p.test(text)).length;
  const density = signalCount / (text.length / 100);
  return density > 1.5;
}
