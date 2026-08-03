---
id: sl-j6g9
status: open
deps: [sl-joeq]
links: [sl-joeq, sl-f0x6]
created: 2026-07-31T14:42:52Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-38, coverage, core]
---
# Feature 38 epic: hierarchical field coverage

Implement archive/features/38-hierarchical-coverage/PRD.md. Make field coverage correct and single-definition for nested records, lists of records, and schemas that reuse field names across depths, so a coverage percentage can be trusted as a merge gate.

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


## Notes

**2026-08-02T21:43:08Z**

Exploratory test pass over the merged feature-35 + feature-38 work (main @ e831be3). All package suites green: core 556, cli 980, lsp 295, viz-backend 174, viz 111, vscode golden 7. Note satsuma-viz needs 'npm install' after b7ff50f — the @satsuma/viz-backend devDependency added by sl-5nsv is absent in stale trees and the parity test then fails to load rather than to assert.

Verified passing against the PRD's acceptance tests: name-shadowing at every depth (AT1-4, AT6 on deep-nested-bugs.stm), nested_arrow (AT7), flatten-in-each on examples/nested-iteration/pipeline.stm reporting 8/9 and 8/8 with orders.parcels.barcode the single gap (AT8, AT29), empty each body and computed-arrow-into-container both uncovered (AT16, AT17, per ADR-037), leaf-only percentages and depth invariance (AT18, AT19), whole-structure conferral including the empty-body and pipe-chain-body forms and the direct-vs-derived distinction (AT22-25, ADR-037/038). CLI, LSP and VS Code paths agree everywhere tested. fields --unmapped-by matches coverage --uncovered leaf for leaf across every mapping in examples/ and the CLI fixtures, with one exception (sl-ymxs).

The epic stays open on its own acceptance criterion — 'coverage figures reported by the CLI, the VS Code status bar and the viz card are identical for the same workspace'. The viz card is not identical: it keeps a third derivation of covered paths (satsuma-viz/src/field-coverage.ts) that implements neither the NL @ref tier (sl-46wr, twelve shipped examples disagree) nor whole-structure conferral (sl-csrs). Also raised: sl-qead (a spread redeclaring an explicit field counts it twice, in the shipped corpus) and sl-lctd (R3/AT21 container state counts never reported by the CLI). Outside this epic: sl-8ba4 (--fail-under gates a rounded percentage, so 200/201 passes --fail-under 100), sl-ymxs, sl-v6rt.
