# 02_fix — change the cause, not the symptom

One job: the smallest change at the defect's cause that turns the reproduction green without weakening it.

## Inputs
- Working (this run): `.github/icm/01-fix/stages/01_reproduce/output/reproduction.md`
- Reference (every run): `.github/icm/_shared/conventions.md`
- Reference (every run): `.github/icm/_shared/gotchas.md`
- Reference (only when the change touches the client, a tool or a payload): `.github/icm/_shared/api-alignment.md`
- Reference (only when the change touches the build, the manifest or the install scripts): `.github/icm/_shared/build-and-test.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/documents.md`.

## Process
1. Read the reproduction and confirm the cause in the code before changing anything.
2. Change the cause. Do not edit the test to make it pass; if it was wrong, go back to stage 01.
3. Keep the contract: a tool's name, arguments and result shape, a config option's meaning, the manifest's `contracts.tools`. If the fix needs a new tool, option or API route, stop: the person starts `02-feature` with `reproduction.md` (route `fix-to-feature`).
4. Run the reproduction (green), the test files of the modules you touched, then `npm test` and `npm run build`. Run `npm run typecheck` and confirm the error count did not rise.
5. If the fix is a lesson, add one line to [gotchas.md](../../../_shared/gotchas.md) with its source.

## Outputs
- change.md → output/ — the cause in one paragraph; each file changed and why; the reproduction's passing output; `npm test`, build and typecheck results; what the fix deliberately leaves alone.

## Human check
A person reads the diff beside the reproduction and confirms it removes the cause and changes no tool name, option or manifest contract. Edit `change.md` if the explanation is wrong; stage 03 reads it.
