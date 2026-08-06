---
id: gpt-pwze
status: closed
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


## Notes

**2026-08-06T15:28:07Z**

**2026-08-06T00:00:00Z**

Cause: `workspace-arbitraries.js` builds only well-formed workspaces, so validate's seven rules, import-scope, and all six lint rules were proved by hand-written fixtures alone. Nothing generated input the toolchain should reject.
Fix: added `src/mutators.js` — 12 defect mutators and 3 null mutators over the `WorkspaceDefect` contract, exported from the barrel, with 31 unit tests. Reaches all seven validate rules, `import-scope`, and all six lint rules. (commit immediately after c4a23881)

Verification went beyond the acceptance criteria. Rather than a single mutation check, the predictions were compared against the real toolchain differentially: every mutator's output rendered over 12 generated bases, run through the built CLI's `validate --json` and `lint --json`, and compared as multisets in BOTH directions. 194 defect checks and 70 null-mutator checks, zero mismatches — no missed and no spurious prediction. A reachability case additionally proves all 15 mutators are applicable to at least one `workspaceScenarioArbitrary` sample (rarest 23/300), so none can go dead over the domain R2 and R5 actually generate.

The ground truth is independent: the package still declares only `fast-check`, and `workspaceHasSchemaCycle` is naive BFS reachability from the definition of a cycle, not a copy of core's iterative Tarjan SCC.

Three corrections made after review:

- The `REGISTERED_RULES` fixture the two coverage cases assert against was built from `DIAGNOSTIC_RULES` — the constants under test — so a mistyped rule id would have moved `reached` and `registered` together and left both cases green. Replaced with literals transcribed from the three registries.
- The module header and README contradicted themselves on the comparison: one paragraph correctly insisted repeated `(rule, file, entity)` keys are meaningful and counts must be compared, the next stated the claim as set union. A consumer following the second reading would collapse a mid-chain cascade into one diagnostic and silently stop checking the completeness rule this module exists to state. Both now say multiset sum.
- `typedScalarField` was added, exported, and never called — the two retyping mutators set `.type` on a cloned declaration instead. Deleted, with the load-bearing part of its rationale (why `scalarField` must stay arity-1: arbitraries pass it to `Array#map`, which supplies the index) kept on `scalarField`.

Also documented: defect mutators deep-copy, the two null mutators that delegate to `permuteWorkspaceDeclarations`/`splitWorkspaceAcrossFiles` do not, so chaining order matters.

Rules the mutator set cannot reach, as the acceptance criteria require naming:

- `unenumerated-record-target` for a spread-bearing target schema. `endpointKind` skips any schema whose `hasSpreads` is set rather than one whose spreads failed to resolve, which is what its own comment claims — so the rule is silent there and a mutator predicting a diagnostic would fail for a reason unrelated to the mutation. Filed as `gpt-i1uv`, proved with a differential pair of mappings whose arrows are identical and whose targets differ only by a resolved spread.
- `cyclicWorkspaceArbitrary` is not lint-clean to begin with (it declares a real lineage cycle), so `workspaceHasSchemaCycle` is exported for R2/R5 to exclude it rather than mistaking a pre-existing finding for a mutation's.

Contract facts R2 and R5 must know, all stated in the module header: compare multisets, not sets; `file` is workspace-relative so compare basenames; `entity` is observable only as a substring of the message, because neither `SemanticDiagnostic` nor `LintFinding` carries an entity field; `validate --json` has no `rule` field, so R2 must go through `collectSemanticWarnings`; and four mutators have low applicability over the generated domain (~8-19%), so R2 must not reduce fast-check's run count.
