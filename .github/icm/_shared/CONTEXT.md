# Shared reference

What every job on this repository draws on. Each file points at the repository file that owns a fact; follow the pointer for the detail, and when the two disagree the owning file is right.

| File | Answers |
|---|---|
| [architecture.md](architecture.md) | the map: entry, manifest, the 43 tools in six groups, the client, hooks, pipelines, memory corpora, cache, skills |
| [api-alignment.md](api-alignment.md) | what must match memoryrelay/api (tool names, retired routes, payload shapes), the 2026-10-04 review and what is still open |
| [build-and-test.md](build-and-test.md) | commands, Node versions, the install hooks, build and packaging, tests, the CI jobs |
| [conventions.md](conventions.md) | pinned context first, pipelines of pure stages, context and namespaces, config resolution, the client, pull requests |
| [release.md](release.md) | where the version lives, how a version reaches npm, what has drifted in the release path |
| [gotchas.md](gotchas.md) | OpenClaw host traps and plugin traps, each with its source |
| [documents.md](documents.md) | which documents are pinned, which are history, and the known drift in each |

Each stage's contract names the files it loads.
