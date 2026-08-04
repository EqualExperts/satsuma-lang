---
id: sl-unr3
status: closed
deps: []
links: []
created: 2026-08-04T09:53:53Z
type: epic
priority: 2
assignee: Thorben Louw
---
# Generated test-stats.json replaces hardcoded test/command counts

README, AGENTS.md, PROJECT-OVERVIEW.md, and the website (site/*.njk) all hardcode test counts (parser corpus tests, per-package test counts) and the CLI command count. These drift constantly and are already internally inconsistent (site/cli.njk says 22 CLI commands, site/learn.njk says 23; AGENTS.md says satsuma-core has 679 tests, it actually has 689). Replace every hardcoded number with a single generated test-stats.json at repo root, kept fresh by the pre-commit hook (near-zero extra cost, reusing output the hook already produces) and verified by a CI drift check. The website bakes the numbers in at build time from this file; README/AGENTS.md/PROJECT-OVERVIEW.md link to it instead of hardcoding.

## Acceptance Criteria

test-stats.json exists at repo root and is the single source of truth. No file changed by this epic contains a hardcoded parser/CLI/LSP test count or CLI command count. Pre-commit hook keeps it fresh with no measurable extra test run. CI fails if it drifts from a fresh computation. Website stats sections render the same numbers as test-stats.json with no cross-page inconsistency.

