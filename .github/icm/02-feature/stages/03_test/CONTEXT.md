# 03_test — prove it the way CI will

One job: tests for each line of the spec, and the suites CI runs, green.

## Inputs
- Working (this run): `.github/icm/02-feature/stages/02_implement/output/implementation.md`
- Reference (every run): `.github/icm/_shared/build-and-test.md`
- Reference (only when a test asserts what the client sends): `.github/icm/_shared/api-alignment.md`

Do NOT load: the other pipelines, other runs' output, `.github/icm/_shared/release.md`.

## Process
1. Write the tests the spec named: a unit test per new pipeline stage, client tests with `fetch` stubbed for each new path and payload, tool tests for dispatch and the unsupported fallback, hook tests with the SDK mocked.
2. Run `npm test`, `npm run build` and import `dist/index.js` as `ci.yml` does; run `npm run typecheck` and confirm the error count did not rise.
3. For a new API route, confirm it exists in memoryrelay/api's OpenAPI schema on `main` (no test here checks that) and record how.

## Outputs
- tests.md → output/ — the tests added, mapped to spec lines; the suite, build and typecheck output; how each new route was confirmed against the API.

## Human check
A person reads `tests.md` and confirms each spec line has a test that would fail without the change.
