# 02-feature — add a capability

One run is one capability: a tool, a config option, a hook behaviour, a memory corpus, or catching up with a change in memoryrelay/api, agreed on paper before it is built. `feat(…)` is the most common subject among the last 60 merged pull requests. Every tool is a contract with two other parties, the OpenClaw host (the manifest) and the API (its routes and the tool names in memoryrelay/api), so the spec names both.

Stages, in order; inputs, outputs and checks for each are in [CONTEXT.md](CONTEXT.md):

1. [Spec](stages/01_spec/CONTEXT.md) — what, why, which tools and options, which API routes, what is not built.
2. [Implement](stages/02_implement/CONTEXT.md) — build what the spec says, on every surface it names.
3. [Test](stages/03_test/CONTEXT.md) — prove it the way CI will.
4. [Docs](stages/04_docs/CONTEXT.md) — README, changelog and version, the pull request.

Nothing moves to the next stage until a person has read the output of the last one.
