---
id: sl-j6g9
status: open
deps: [sl-joeq]
links: [sl-joeq]
created: 2026-07-31T14:42:52Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-38, coverage, core]
---
# Feature 38 epic: hierarchical field coverage

Implement features/38-hierarchical-coverage/PRD.md. Make field coverage correct and single-definition for nested records, lists of records, and schemas that reuse field names across depths, so a coverage percentage can be trusted as a merge gate.

Six defects verified against branch feat/35-coverage-command (HEAD fc3d5a5), not main — feature 35 is substantially implemented there:
1. Bare-segment registration makes coverage name-based, reporting unmapped fields as mapped (raised separately as sl-joeq, this epic depends on it).
2. nested_arrow contributes no coverage at all.
3. flatten nested inside each — and any block inside flatten — is not walked. Running the branch's computeMappingCoverage on examples/nested-iteration/pipeline.stm reports the target schema at 75% when it is 100% mapped, so --fail-under 90 would fail a fully-mapped spec on the repo's own canonical nested example.
4. Three percentage conventions ship, all different: VS Code status bar counts top-level fields only (a record with 1 of 3 leaves mapped reports 100%), the viz card counts every node including containers, the new core rollup counts leaves only.
5. Two independent walkers diverge on nesting — the CLI derives paths from extract.ts and is correct; computeMappingCoverage does its own CST walk and is not. Feature 35's sl-oqsj requires the two to agree, which they cannot on any nested fixture.
6. Container semantics are contradictory by construction: LSP treats a record as covered when ANY descendant is, the CLI only when ALL descendants are. One boolean cannot carry both claims.

Root cause of most of it: the covered set is a flat bag of strings mixing 'an arrow wrote exactly this', 'this is an ancestor of that', and 'this is a segment of that', with no way to tell them apart.

## Acceptance Criteria

All PRD requirements R1-R7 delivered; the 31 acceptance tests in the PRD pass, including the nine that must fail before the work starts; coverage figures reported by the CLI, the VS Code status bar and the viz card are identical for the same workspace; features/38 PRD open questions resolved and recorded.

