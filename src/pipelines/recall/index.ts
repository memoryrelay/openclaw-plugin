import type { RecallStage } from "../types.js";
import { recallTriggerGate } from "./trigger-gate.js";
import { recallScopeResolver } from "./scope-resolver.js";
import { recallEmbedQuery } from "./embed-query.js";
import { recallSearch } from "./search.js";
import { recallRank } from "./rank.js";
import { recallFormat } from "./format.js";

export const recallPipeline: RecallStage[] = [
  recallTriggerGate, recallScopeResolver, recallEmbedQuery, recallSearch, recallRank, recallFormat,
];

export { recallTriggerGate, recallScopeResolver, recallEmbedQuery, recallSearch, recallRank, recallFormat };
