---
id: gpt-mcw4
status: open
deps: []
links: []
created: 2026-08-06T15:21:40Z
type: task
priority: 3
assignee: Thorben Louw
tags: [cli, lint, docs]
---
# cli: satsuma lint --help hardcodes a third listing of the rule set, unpinned

gpt-o0fk pinned the registry against SATSUMA-CLI.md's rule table. A THIRD hand-maintained listing survives: `addHelpText("after", ...)` at tooling/satsuma-cli/src/commands/lint.ts:149-155 prints all six rule ids WITH their severities on `satsuma lint --help`, and nothing checks it against RULES. A newly registered rule therefore ships a stale user-facing help screen — the same sl-w1dr drift class gpt-o0fk exists to close.

It is also the only place a severity claim is pinnable docs-to-docs today: LintRule is `{ id, description, check }` (tooling/satsuma-cli/src/types.ts:260-264) and severity lives as a literal inside each check function, so pinning the table's Severity column to the registry needs a production change (see below).

Rule descriptions are a third drift surface of the same shape — three hand-maintained prose variants of one rule: lint-engine.ts:52 'NL references schema not in source/target list', SATSUMA-CLI.md:122 'NL text references a schema not in the mapping's source/target list', lint.ts:151 '@ reference in NL does not resolve...'.

## Acceptance Criteria

A test case in tooling/satsuma-cli/test/docs.test.ts's lint-registry suite runs `lint --help`, parses the Rules block, and asserts its id set equals the registry's in both directions. Separately decide — and record the decision, even if the answer is no — whether severity and fixable move onto LintRule so the docs table's Severity/Fixable columns become pinnable rather than prose. If descriptions are consolidated, one of the three becomes the source and the others are derived or pinned.

