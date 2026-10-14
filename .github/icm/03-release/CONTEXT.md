# 03-release — the pipeline

Plan, make every version place agree, publish by hand, confirm on npm.

| Stage | Job | Input | Output | Human check |
|---|---|---|---|---|
| [`01_plan`](stages/01_plan/CONTEXT.md) | choose the version | the request | `output/plan.md` | A person approves the version number and the list of changes. |
| [`02_prepare`](stages/02_prepare/CONTEXT.md) | make every version place agree | 01_plan's `plan.md` | `output/prepared.md` | A person confirms every version place agrees on `main`, merging the release pull request if there is one. |
| [`03_publish`](stages/03_publish/CONTEXT.md) | publish and confirm on npm | 02_prepare's `prepared.md` | `output/published.md` | A person sees the new version on npm and reads the upgrade note before announcing it. |
