# 04-deps — the pipeline

The published package has no runtime dependencies; most bumps touch only the dev tree, and a host bump changes what the plugin is tested against.

| Stage | Job | Input | Output | Human check |
|---|---|---|---|---|
| [`01_review`](stages/01_review/CONTEXT.md) | review the bump | the pull request | `output/review.md` | A person decides to merge, close or supersede the pull request. |
