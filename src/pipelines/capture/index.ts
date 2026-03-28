import type { CaptureStage } from "../types.js";
import { captureTriggerGate } from "./trigger-gate.js";
import { captureMessageFilter } from "./message-filter.js";
import { captureContentStrip } from "./content-strip.js";
import { captureTruncate } from "./truncate.js";
import { captureDedup } from "./dedup.js";
import { captureStore } from "./store.js";

export const capturePipeline: CaptureStage[] = [
  captureTriggerGate, captureMessageFilter, captureContentStrip, captureTruncate, captureDedup, captureStore,
];

export { captureTriggerGate, captureMessageFilter, captureContentStrip, captureTruncate, captureDedup, captureStore };
