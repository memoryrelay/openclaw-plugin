# 01-fix — fix a defect

One run is one defect: reproduced in a test, fixed at its cause, verified the way CI verifies, and proposed as a pull request that carries its version. `fix(…)` is the second most common subject among the last 60 merged pull requests, and four of them (0.25.1 to 0.25.4) were an OpenClaw host release breaking the plugin.

Stages, in order; inputs, outputs and checks for each are in [CONTEXT.md](CONTEXT.md):

1. [Reproduce](stages/01_reproduce/CONTEXT.md) — make it fail in a vitest test, for the reason reported.
2. [Fix](stages/02_fix/CONTEXT.md) — change the cause; the reproduction turns green.
3. [Verify](stages/03_verify/CONTEXT.md) — the suites CI runs, version and changelog, the pull request.

Nothing moves to the next stage until a person has read the output of the last one.
