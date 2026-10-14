# 03-release — publish a version to npm

One run is one version of `@memoryrelay/plugin-memoryrelay-ai` reaching npm. The version is usually bumped in the pull request that ships the change; this pipeline checks it is complete, and after the merge a person dispatches the publish. Eleven versions went out this way, 0.25.0 to 0.30.0.

Stages, in order; inputs, outputs and checks for each are in [CONTEXT.md](CONTEXT.md):

1. [Plan](stages/01_plan/CONTEXT.md) — which version, what is in it, whether it breaks anything.
2. [Prepare](stages/02_prepare/CONTEXT.md) — every version literal and the changelog agree; a release pull request if one is needed.
3. [Publish](stages/03_publish/CONTEXT.md) — a person dispatches the publish; the version is on npm.

Nothing moves to the next stage until a person has read the output of the last one.
