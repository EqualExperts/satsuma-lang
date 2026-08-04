---
id: mbt-foes
status: open
deps: []
links: []
created: 2026-08-04T11:08:17Z
type: task
priority: 2
assignee: Thorben Louw
parent: mbt-5l7g
---
# R1: Investigation spike — hoisting audit and CI baseline for workspaces migration

Audit shared-dependency versions across all ten tooling/*/package.json files for hoisting conflicts (typescript, eslint, c8, web-tree-sitter, ...). Inventory every install-order-sensitive script: satsuma-cli's prepare -> build:core/build:viz-backend chain and the --ignore-scripts workaround in ci:all, and tree-sitter-satsuma's deliberate node-gyp skip (ADR-002). Capture the current CI baseline wall-clock time (install job + total pipeline) so later tickets have a measured before/after.

## Acceptance Criteria

- Findings note lists any shared-dependency version conflicts found (or states none found)
- Findings note lists every install-order-sensitive script and confirms tree-sitter-satsuma's native-build skip is unaffected by hoisting
- Baseline CI wall-clock timing (install job + full pipeline) recorded for comparison in R2 and R5
- ADR-049 already covers the architectural decision (workspaces + Turborepo, local-only cache) -- no new ADR needed from this ticket unless the audit surfaces a blocker that changes that decision

