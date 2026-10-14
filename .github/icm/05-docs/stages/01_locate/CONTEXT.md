# 01_locate — find the owner of each wrong statement

One job: a list of wrong statements, each with the file and line that owns the truth.

## Inputs
- Working (this run): the report — an issue, a reader's question, or an item under "Known drift" in `.github/icm/_shared/documents.md`.
- Reference (every run): `.github/icm/_shared/documents.md`
- Reference (every run): `.github/icm/_shared/architecture.md`
- Reference (only when the statement is about the API, a route or a tool name): `.github/icm/_shared/api-alignment.md`
- Reference (only when the statement is about releasing or installing): `.github/icm/_shared/release.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/gotchas.md`.

## Process
1. Read the document section whole.
2. For each statement that may be wrong, find the owning file and line and say what it says now.
3. If the code is what is wrong, stop: that is `01-fix`.

## Outputs
- locations.md → output/ — each wrong statement (document and line), its owner (`path:line`), what the owner says.

## Human check
A person confirms each owning file before any edit.
