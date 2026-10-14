# 01-fix — the pipeline

Make it fail, make it pass for the right reason, prove it the way CI will. Publishing is `03-release`, started by a person after the merge.

| Stage | Job | Input | Output | Human check |
|---|---|---|---|---|
| [`01_reproduce`](stages/01_reproduce/CONTEXT.md) | reproduce the reported defect | the report | `output/reproduction.md` | A person runs the test, or reads its output, and confirms it fails for the reported reason and not a neighbouring one. |
| [`02_fix`](stages/02_fix/CONTEXT.md) | change the cause, not the symptom | 01_reproduce's `reproduction.md` | `output/change.md` | A person reads the diff beside the reproduction and confirms it removes the cause and changes no tool name, option or manifest contract. Edit `change.md` if the explanation is wrong; stage 03 reads it. |
| [`03_verify`](stages/03_verify/CONTEXT.md) | checks, version, pull request | 02_fix's `change.md` | `output/pull-request.md` | A reviewer reads `pull-request.md` and the CI results and merges or sends it back; after a merge, the person decides whether to start `03-release` to publish. |
