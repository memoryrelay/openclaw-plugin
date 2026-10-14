# 02-feature — the pipeline

Spec, build, prove, document. Publishing is `03-release`, started by a person after the merge.

| Stage | Job | Input | Output | Human check |
|---|---|---|---|---|
| [`01_spec`](stages/01_spec/CONTEXT.md) | say what will exist and what it calls | the request | `output/spec.md` | A person approves the spec, in particular the tool names and routes against memoryrelay/api and whether it is breaking. |
| [`02_implement`](stages/02_implement/CONTEXT.md) | build what the spec says | 01_spec's `spec.md` | `output/implementation.md` | A person reads the diff against the spec: every surface named is built, nothing else is, and the manifest lists every new tool. |
| [`03_test`](stages/03_test/CONTEXT.md) | prove it the way CI will | 02_implement's `implementation.md` | `output/tests.md` | A person reads `tests.md` and confirms each spec line has a test that would fail without the change. |
| [`04_docs`](stages/04_docs/CONTEXT.md) | README, changelog, version, pull request | 03_test's `tests.md` | `output/pull-request.md` | A reviewer reads `pull-request.md`, the README diff and CI, then merges or sends it back; after a merge, the person decides whether to start `03-release`. |
