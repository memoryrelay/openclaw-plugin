# 05-docs — the pipeline

Find the owner of each fact, then correct the document to it, never the other way.

| Stage | Job | Input | Output | Human check |
|---|---|---|---|---|
| [`01_locate`](stages/01_locate/CONTEXT.md) | find the owner of each wrong statement | the report | `output/locations.md` | A person confirms each owning file before any edit. |
| [`02_edit`](stages/02_edit/CONTEXT.md) | correct the document | 01_locate's `locations.md` | `output/pull-request.md` | A reviewer reads the diff beside `locations.md` and merges or sends it back. |
