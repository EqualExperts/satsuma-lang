---
id: sl-ce11
status: closed
deps: []
links: []
created: 2026-07-31T13:12:19Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-35, cli, core]
---
# Feature 35 epic: workspace coverage command (satsuma coverage)

Implement features/35-coverage-command/PRD.md: relocate computeMappingCoverage from satsuma-lsp into @satsuma/core, add a satsuma coverage CLI command with per-mapping/per-schema/workspace rollups, a stable --json contract, and a --fail-under CI gate. Open questions resolved by user review 2026-07-31: per-field entries carry declaration line numbers; aggregate covers both roles clearly labelled; --fail-under respects active scope flags.

Doc review 2026-07-31 changed three things. (1) `fields --unmapped-by` is an existing fourth implementation of these semantics; it is kept as a convenience alias but re-based on the relocated core function (sl-oqsj), else the feature ships the drift it exists to prevent. (2) --fail-under uses a distinct exit code 3, because reusing 1 would make a misspelled --mapping indistinguishable from genuine under-coverage in CI (sl-268g). (3) The aggregation was split into a core half (sl-4qvp) and a CLI half (sl-3ms0) so feature 36's browser-only overlay is not serialised behind CLI plumbing it never uses.

