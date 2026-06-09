---
id: sl-vmqv
status: open
deps: []
links: [sl-2a7k]
created: 2026-06-09T22:15:23Z
type: chore
priority: 2
assignee: Thorben Louw
external-ref: gh-265
---
# Add Windows job to CI matrix to catch platform path/URL bugs

All CI jobs in .github/workflows/ci.yml run on ubuntu-latest. The Windows-only CLI startup crash (gh-265 / sl-2a7k) and the malformed Windows diagnostic URI in satsuma-lsp shipped undetected because nothing exercises the toolchain on Windows. This class of bug (raw OS paths used where file:// URLs are required, path-separator assumptions, drive-letter handling) is invisible to a Linux-only matrix.

## Design

Add a windows-latest job (or a windows-latest shard to the existing test matrix). Keep it focused: it does not need full coverage reporting — a smoke job that builds the workspace (npm run install:all) and runs the CLI integration suite plus the satsuma-lsp suite is enough to catch path/URL regressions, since those are the consumers that spawn the CLI and build file:// URIs. Mind Windows specifics: bash vs pwsh default shell (set 'shell: bash' on steps that use POSIX syntax), CRLF/line-ending differences in golden fixture comparisons, and slower npm installs. Use fail-fast: false so a Windows failure does not mask Linux results.

## Acceptance Criteria

ci.yml runs at least the CLI integration tests and the satsuma-lsp tests on windows-latest on every PR; the job is required for merge; a deliberately reintroduced raw-path import() (the gh-265 regression) would fail this job; README/CONTRIBUTING note the supported CI platforms if such a list exists.

