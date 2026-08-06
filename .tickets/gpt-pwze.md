---
id: gpt-pwze
status: open
deps: []
links: [gpt-uazn, gpt-o0fk]
created: 2026-08-06T13:44:10Z
type: task
priority: 1
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, scenario-gen]
---
# scenario-gen: defect mutators and the WorkspaceDefect contract (R1)

workspace-arbitraries.js builds only well-formed workspaces on purpose — Feature 41 needed input the toolchain accepts, and generated-workspace.test.ts asserts exactly that. Nothing generates input the toolchain should reject, so validate's seven rules, import-scope, and the lint engine's four rules are all proved by hand-written fixtures. The bug history is concentrated there (sl-rw3e, sl-padl, lnd-qqo7, and the batches validate-bugs.test.ts and namespace-bugs.test.ts are named after).

## Design

Add tooling/satsuma-scenario-gen/src/mutators.js exporting functions that take a valid generated workspace and return a WorkspaceDefect: { workspace, mutation: {kind, target}, expected: [{rule, file, entity, line}] }. Two rules keep it honest. (a) The predicted set is COMPLETE, not minimal — one defect cascades (deleting a field breaks every arrow naming it), so 'exactly one diagnostic' would be a wrong oracle; a mutator that cannot predict its full consequence set does not belong here. (b) Each mutator states a precondition the consuming property checks: the pre-mutation workspace must validate clean, so a vacuous mutation fails visibly instead of masquerading as a missed diagnostic. Predicted diagnostics are named by rule id and entity, never by message text or byte offset — wording is a consumer concern and would make this package a second implementation of diagnostic formatting. No dependency on @satsuma/core (the existing cycle rule). Defect mutators: delete a field a target arrow names; duplicate an entity into a second file; duplicate within one file; break an import; reference an undefined entity; point an NL @ref at a name no source declares; introduce a lineage cycle; change a field's declared type so a bare arrow connects mismatched types; conflict a namespace-level metadata tag. Null mutators (must produce NO new diagnostic): reorder declarations, split across more files, reformat, rename consistently — promoting the existing permuteWorkspaceDeclarations and splitWorkspaceAcrossFiles from edge-set stability to diagnostic-set stability. Cover all six lint rules: lint-engine.ts registers type-mismatch-direct-arrow and lineage-cycle through the TYPE_MISMATCH_RULE_ID and LINEAGE_CYCLE_RULE_ID constants core exports rather than as literal id strings, so an audit of the registry by eye misses them. All six are reachable from `satsuma lint`.

## Acceptance Criteria

Every defect mutator is covered by a scenario-gen unit test asserting the mutation applied and the expected set is non-empty. Every null mutator is shown to change the rendered source but not the declared entity or edge set. The package still has no dependency on @satsuma/core. A mutator whose precondition does not hold on a given workspace reports that rather than returning a vacuous defect. The defect mutator set reaches all six registered lint rules and all seven validate rules, or names the ones it cannot reach and why.

