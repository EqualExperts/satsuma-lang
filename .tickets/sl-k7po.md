---
id: sl-k7po
status: closed
deps: []
links: []
created: 2026-08-04T09:54:30Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-unr3
---
# Add scripts/generate-test-stats.mjs to compute and write test-stats.json

Write a Node ESM script that produces test-stats.json at repo root: {cliCommands, parserCorpusTests, packages: {satsuma-core, satsuma-cli, satsuma-lsp, satsuma-viz-model, satsuma-viz-backend, satsuma-viz, vscode-satsuma}}. cliCommands is counted structurally via ast-grep ('program.command($ARG)' over tooling/satsuma-cli/src/commands/*.ts --json, array length -- verified gives 23 today, matching cli.njk not index.njk's stale 22). parserCorpusTests is parsed from tree-sitter's own 'Total parses: N; successful parses: N; ...' summary line. Per-package counts are parsed from Node's built-in test runner summary line ('tests N', printed by 'node --test' regardless of reporter -- verified today: satsuma-core prints 'tests 689'). Support two input modes behind the same parsing logic: (1) default -- spawn each package's npm test itself and parse its stdout; (2) '--from-logs <dir>' -- read already-captured log files named after each package instead of re-running anything (needed by the pre-commit hook wiring in a dependent ticket, so that hook stays near-zero extra cost). satsuma-viz-harness (Playwright) is deliberately excluded -- it already has a documented human-in-the-loop-only run process (see AGENTS.md's Playwright section) and is not run by scripts/run-repo-checks.sh today. No timestamp field in the JSON -- diffs should only ever reflect a real count change.

## Acceptance Criteria

node scripts/generate-test-stats.mjs (no flags) runs every package's tests and writes a correct test-stats.json matching current reality. node scripts/generate-test-stats.mjs --from-logs <dir-of-precomputed-logs> produces an identical result without spawning any test command. Script has its own test coverage for the parsing logic (summary-line regex extraction, ast-grep command counting) using small fixture strings/dirs, not by depending on the real repo's live counts. npm run lint passes.


## Notes

**2026-08-04T10:05:12Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: README/AGENTS.md/PROJECT-OVERVIEW.md/site all hardcoded test and CLI-command counts with no generation mechanism, so they drifted (confirmed: satsuma-core actually has 689 tests vs AGENTS.md's stated 679; site/cli.njk said 22 CLI commands while site/learn.njk said 23).
Fix: Added scripts/generate-test-stats.mjs, which writes test-stats.json (cliCommands, parserCorpusTests, per-package test counts) from each tool's own summary output — Node's built-in test runner's "tests N" line, tree-sitter's "Total parses: N" line, and the built CLI's own --help command list (excluding commander's auto-appended help entry). Supports a --from-logs mode so a caller that already captured test output doesn't need to re-run anything. Verified byte-identical output between default (spawn) and --from-logs modes, and idempotent across repeated runs. (commit immediately after 8e69721c)
