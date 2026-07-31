---
id: sl-oqsj
status: open
deps: [sl-gsxu, sl-5sjp]
links: []
created: 2026-07-31T13:13:05Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-ce11
tags: [feature-35, cli]
---
# cli: add satsuma coverage command (per-mapping report, scoping flags, --json)

PRD 35 R2. New command in tooling/satsuma-cli/src/commands/coverage.ts using the relocated core function. Default scope: every mapping reachable from the entry file (imports followed). Flags: --mapping <name>, --schema <name>, --role source|target, --uncovered, --json.

## Design

Follow existing command-loader conventions. Human output: per-mapping table (schema, role, covered/total, percent) then uncovered field paths — compact enough to paste in a review comment. JSON entries carry path, role, mapped, file, line (from sl-5sjp).

Re-base `fields --unmapped-by`, keep it as an alias (added after doc review 2026-07-31). The CLI already has a fourth coverage implementation: `fields <schema> --unmapped-by <mapping>` (commands/fields.ts:89-103) computes the per-mapping uncovered set via its own private getMappedFieldNames() + filterUnmappedFields() helpers over core's addPathAndPrefixes. User decision: keep the flag — it is documented, agent-facing, and the natural single-schema shorthand — but delete those two private helpers and delegate to the core function relocated in sl-gsxu. Without this, shipping `coverage` leaves two CLI commands answering the same question from independently maintained code, which is the drift this feature exists to prevent.

Scope-argument exit codes: an unresolvable --mapping/--schema exits 1 (EXIT_NOT_FOUND), as `fields` already does at fields.ts:98. Keep this distinct from the coverage-threshold code introduced in sl-268g.

## Acceptance Criteria

Command registered and documented in --help; nested-path semantics verified (covering address.city covers address; sibling address.line1 uncovered); each/flatten source paths contribute coverage identically to pre-move LSP behaviour; scoping flags and --uncovered work and are tested; --json validates against the shape that will be documented in SATSUMA-CLI.md; golden fixture test from an examples/ workspace.

`fields --unmapped-by` delegates to the core coverage function with getMappedFieldNames/filterUnmappedFields deleted; a test asserts `fields Y --unmapped-by X` and `coverage --uncovered --mapping X --schema Y` report the identical field set on one fixture, locking the two surfaces together; unresolvable scope arguments exit 1; all CLI tests pass locally.

