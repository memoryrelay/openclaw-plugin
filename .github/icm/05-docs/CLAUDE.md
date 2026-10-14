# 05-docs — correct a document that disagrees with the code

One run is one document brought back in line with the code that owns its facts, with no code change. Pull requests #75 and #81 were documentation runs; [documents.md](../_shared/documents.md) lists the drift found on 2026-10-14.

Stages, in order; inputs, outputs and checks for each are in [CONTEXT.md](CONTEXT.md):

1. [Locate](stages/01_locate/CONTEXT.md) — each wrong statement and the file that owns the truth.
2. [Edit](stages/02_edit/CONTEXT.md) — the document corrected, the pull request.

Nothing moves to the next stage until a person has read the output of the last one.
