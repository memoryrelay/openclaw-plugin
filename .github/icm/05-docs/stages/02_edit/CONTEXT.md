# 02_edit — correct the document

One job: the document says what its owners say, proposed as a pull request.

## Inputs
- Working (this run): `.github/icm/05-docs/stages/01_locate/output/locations.md`
- Reference (every run): `.github/icm/_shared/documents.md`
- Reference (every run): `.github/icm/_shared/conventions.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/api-alignment.md`.

## Process
1. Edit each statement to match its owner; keep the document's voice and structure.
2. Remove the item from "Known drift" in [documents.md](../../../_shared/documents.md), bump its `verified_at` and `verified_commit`, and run `python .github/icm/_system/generate.py`.
3. Open the pull request, subject `docs(<scope>): …`. A docs-only change needs no version bump. Watch CI; never merge it yourself.

## Outputs
- pull-request.md → output/ — the pull request URL; each statement changed with its owner; CI status.

## Human check
A reviewer reads the diff beside `locations.md` and merges or sends it back.
