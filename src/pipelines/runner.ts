import type { PipelineContext } from "./types.js";

interface Stage<TInput> {
  name: string;
  enabled: (ctx: PipelineContext) => boolean;
  execute: (input: TInput, ctx: PipelineContext) => Promise<
    | { action: "continue"; data: TInput }
    | { action: "skip" }
  >;
}

export async function runPipeline<TInput>(
  stages: Stage<TInput>[],
  input: TInput,
  ctx: PipelineContext,
): Promise<TInput | null> {
  let current = input;
  for (const stage of stages) {
    if (!stage.enabled(ctx)) continue;
    const result = await stage.execute(current, ctx);
    if (result.action === "skip") return null;
    current = result.data;
  }
  return current;
}
