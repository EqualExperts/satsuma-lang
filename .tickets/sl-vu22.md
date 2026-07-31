---
id: sl-vu22
status: open
deps: [sl-qzy3]
links: [sl-2nxu]
created: 2026-07-31T14:43:17Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, core]
---
# core: derive covered paths from extraction instead of maintaining a second CST walker

PRD 38 R4, architectural half. The immediate defects — flatten inside each, and nested_arrow, both unwalked — are raised separately as sl-qzy3 (P1, blocking PR #405) because they are a live regression that should not wait for a feature. This ticket is the structural fix that makes that class of defect impossible rather than fixed case by case.

Coverage paths are derived twice from different sources: computeMappingCoverage walks the CST itself, while extract.ts walks it for arrows and handles every nesting construct uniformly (accumulating-prefix contract documented at :844-852, relative-dot stripping at :911-921). The duplicate walker is why the two disagree, and it is why fields --unmapped-by was correct until sl-oqsj re-based it onto the core path. Three defects of this class have now been found in the CST walker — sc-xnxp (relative dots, fixed), and the two in sl-qzy3 — each caught by inspection rather than by tests.

## Design

SETTLE PRD 38 OPEN QUESTION 1 FIRST — it is the feature's main design decision, and it decides whether this ticket exists at all. Two options: (a) keep the CST walker and patch it per construct (what sl-qzy3 does as the immediate fix), recursing on the shared _nested_block_item production rather than enumerating permitted children per parent so future grammar additions cannot silently fall through; (b) delete the walker and derive covered paths from extract.ts's arrow output. PRD proposes (b), keeping a CST walk only if a consumer needs per-node positions extraction cannot supply — check what the VS Code gutter needs before committing, since it consumes per-field entries with declaration lines.

If (a) is chosen, close this ticket as won't-do once sl-qzy3 lands and record the decision in the PRD; the value here is entirely in removing the duplication.

Also correct viz-model regardless of the choice: EachBlock has nestedEach but no nestedFlatten, FlattenBlock has no target field, and the comment at viz-backend/src/viz-model.ts:1040-1043 justifies this by asserting the grammar forbids nested flatten — it does not (grammar.js:265-270, corpus fixture each_flatten.txt:331-374, and examples/nested-iteration/pipeline.stm:100 all contradict it). Same defect class as sl-7236, whose ticket named the cause: the corpus contains no nested each blocks so round-trip tests do not catch it.

## Acceptance Criteria

Open question 1 resolved and the decision recorded in the PRD. If (b): one derivation path for covered paths, the CST walker in coverage.ts deleted, and every sl-qzy3 regression test still passing against the new derivation — plus each with a dotted multi-segment target (cobol-to-avro:148) qualifying under the full path, and two each blocks writing the same target list (edi-to-json:106-171) unioning without double counting. Either way: viz-model carries nested flatten blocks and a flatten target, the incorrect comment is removed, and viz coverage reflects nested flatten arrows.

