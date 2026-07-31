---
id: sl-5kvp
status: closed
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


## Notes

**2026-07-31T08:55:08Z**

Cause: the Lint CI job installed unpinned ruff; ruff 0.16 replaced its minimal E/F default rule set with a large curated preset, surfacing 48 (53 under our chosen config) violations in existing Python scripts on every PR.
Fix: explicit family-level rule selection in ruff.toml, exact version pins in requirements-dev.txt with a Dependabot pip entry, and all 53 violations fixed properly (no ignores except one justified BLE001 noqa at a CLI error boundary) (commit 9a5886a)
