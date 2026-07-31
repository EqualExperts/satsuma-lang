---
id: sl-oqsj
status: closed
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


## Notes

**2026-07-31T14:11:29Z**

Cause: the CLI had no workspace-level coverage command, and `fields --unmapped-by` computed the per-mapping uncovered set from its own private getMappedFieldNames()/filterUnmappedFields() over index.fieldArrows — a fourth implementation of semantics core now owns.
Fix: added src/commands/coverage.ts (scoping flags --mapping/--schema/--role/--uncovered, human table, --json) plus src/coverage-workspace.ts, which is the only place ExtractedWorkspace is adapted to core's CoverageSchemaResolver: namespace-aware reference resolution, spread expansion on a copied field list, and declaration positions via field-positions.ts. getMappedFieldNames was deleted and fields --unmapped-by now prunes its tree from the same core result, so the two surfaces cannot drift; a test asserts they report the identical field set on the unmapped-nested fixture, and a second asserts both report empty for a fully-mapped schema.

Two decisions worth recording. (1) Core gained an optional CoverageSchemaDefinition.schemaId so the consumer reports the resolved canonical key rather than the reference as written — without it a namespaced schema written both ways splits into two entries when rolled up. (2) Reported field lists are leaf-only (core's leafFieldEntries), matching the counting rule, so a list of paths and the covered/total beside it are always the same population. Anonymous mappings cannot be looked up by label and are reported as skipped rather than silently dropped. 934 CLI tests pass (22 new); eslint clean.
