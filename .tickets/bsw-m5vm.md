---
id: bsw-m5vm
status: open
deps: []
links: []
created: 2026-10-06T09:57:03Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, consistency]
---
# cli: exit-code and --json inconsistencies across commands

Small inconsistencies found in a sweep of all 22 commands over the corpus:

- `context` with no matches exits 1 in text mode but 0 with `--json` (prints `[]`) (`commands/context.ts:72` vs `:104`); every other command agrees across modes.
- `lint --rules --json` prints the plain-text table.
- Parse-error exit codes: `coverage` exits 0 on a file with parse errors though its documented table says 2; `lint --strict` prints "no issues found" and exits 0 on such a file. Most extractors deliberately tolerate parse errors (`load-workspace.ts:57`), but `graph` (sl-la5z) and `validate` exit 2, so the documented contract is inconsistent.
- `summary` and `nl-refs` human output still print `::name`, against the display-form rationale in SATSUMA-CLI.md (755ef6e converted only coverage, lineage and graph; adjacent to sl-9p2t).
- Most commands emit plain-text errors even with `--json`; `validate` and `schema` emit JSON errors.

## Acceptance Criteria

- Each item is fixed or explicitly documented as intended; the parse-error exit policy is stated once in SATSUMA-CLI.md and followed by every command.
