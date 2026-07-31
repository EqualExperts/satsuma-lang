---
id: sl-5kvp
status: in_progress
deps: []
links: []
created: 2026-07-31T08:41:02Z
type: chore
priority: 2
assignee: Thorben Louw
---
# Fix ruff lint drift: 48 errors in scripts/ failing the Lint CI job on every PR

The Lint workflow's ruff version drifted and now enforces new rules (e.g. RUF012 mutable class attribute defaults) against existing Python in scripts/ and tooling/tree-sitter-satsuma/scripts/. 48 errors, 19 auto-fixable. Lint is not a required check so PRs still merge, but every PR shows a red X.

## Acceptance Criteria

ruff passes clean in CI; either fix violations or consciously configure/pin the ruleset

