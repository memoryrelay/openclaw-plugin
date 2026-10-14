# 04-deps — review a dependency bump

One run is one dependency pull request (Dependabot security updates such as #142, #153 and #154) or a bump of the `openclaw` dev dependency the plugin is tested against (#156): read, judged against what this package ships, and decided by a person.

Stages, in order; inputs, outputs and checks for each are in [CONTEXT.md](CONTEXT.md):

1. [Review](stages/01_review/CONTEXT.md) — what changes, whether it reaches users, whether CI proves it.

Nothing moves to the next stage until a person has read the output of the last one.
