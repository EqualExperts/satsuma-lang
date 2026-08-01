---
id: sl-vu22
status: closed
deps: [sl-qzy3]
links: [sl-2nxu, svdfe-s6we]
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


## Notes

**2026-07-31T16:02:34Z**

PRD 38 Open Question 1 RESOLVED — derive from extraction (option b). Recorded in features/38-hierarchical-coverage/PRD.md under Open Questions and R4. This ticket stands as specified; it does not close as won't-do.

Two findings settled it after the PRD was written:

1. A fourth defect of the same class surfaced while fixing sl-joeq: the CST walker never resolved an arrow's schema prefix at all. The qualified form multi-source mappings use (crm_customers.email -> email) matched only via the bare-segment leak, so it could never reach a nested declared path — governance.stm's crm_customers read 6/13 instead of 9/13. extract.ts's consumers (arrows.ts, graph-builder.ts) had handled schema qualification for some time. Four defects found by inspection, none by a test, each a rule the walker lacked and extraction already had.

2. The gutter check this ticket asked for ('check what the VS Code gutter needs before committing') comes back clean. The gutter consumes FieldCoverageEntry.line, which propagates from CoverageField.line supplied by the consumer's resolver — satsuma-lsp/src/coverage.ts maps FieldInfo.range.start.line — not from the arrow walk, which contributes path strings only. No consumer depends on per-node CST positions extraction cannot supply; ExtractedArrow carries line/startColumn regardless.

Implementation note: sl-joeq left the seam in place. collectBodyPaths now yields a string[] of container-qualified AUTHORED references (schema prefix retained), and the new schemaLocalFieldPath in coverage-paths.ts resolves them per schema on top. ExtractedArrow.sources/target are already absolute authored paths of that same shape, so this ticket is a swap of the producer with the resolution step unchanged — not a re-derivation of the semantics. See ADR-035.

**2026-07-31T16:24:21Z**

Cause: coverage.ts maintained its own CST walk for arrow paths alongside extract.ts's, which already handled every nesting construct uniformly. Four defects of that duplication had been found by inspection and none by a test — relative dots unstripped (sc-xnxp), flatten-inside-each and nested_arrow never visited (sl-qzy3), and schema prefixes never resolved (sl-joeq).

Fix: deleted the walker (~130 lines: collectBodyPaths / collectBlockItemPaths / collectContainerPaths / containerTargetBase / isRelativePath / qualify / pathText / PathBases / CONTAINER_BLOCK_TYPES) and derived src/tgt references from extract.ts instead, via a new exported extractMappingArrowRecords(mappingNode, namespace). That function exists because coverage reports on ONE named mapping and two same-named mappings in different namespaces are different mappings, so it cannot filter the whole-file list by label; extractArrowRecords now delegates to it, so no walk was duplicated to add it.

One real divergence had to be handled. For spec §4.6's top-level flatten (flatten contacts -> tgt) the walker produced 'email' while extraction produces 'tgt.email' — which is a SCHEMA-QUALIFIED path, so sl-joeq's schemaLocalFieldPath already resolves it, and the declaresTopLevel guard added there is what keeps the relative form (flatten items -> .packed inside an each, prefix 'orders') from being stripped. One rule needed adding: a bare reference identical to the schema's own name names the schema, not a field, so it returns null instead of entering the covered set as a phantom field.

Verification that the swap is behaviour-preserving: coverage --json over all 47 example files plus all CLI fixtures is byte-identical before and after (zero diff), and all 495 core tests pass unchanged, including every sl-qzy3 and sl-joeq regression test and the both-flatten-forms case.

Second half of the AC — viz-model corrected: EachBlock gains nestedFlatten, FlattenBlock gains targetField plus nestedEach/nestedFlatten, and the incorrect comment asserting the grammar forbids nested flatten is removed. Both extractors now share one extractNestedBlockContents() collector rather than each enumerating permitted children — the same shape the core walk was given in sl-qzy3. viz's forEachMappingArrow walks [...nestedEach, ...nestedFlatten] so the count, hover lookups and coverage overlay all see flatten-inside-each arrows; sz-mapping-detail renders nested flatten sections and shows a flatten's target.

New tests: core 'dotted container targets' — each with a multi-segment target (cobol-to-avro:148) qualifying under the full path, and three each blocks writing the same target list (edi-to-json:137-171) unioning without swallowing a gap; coverage-paths cases for the bare-schema-name rule; viz-backend cases for flatten targetField and each/flatten nesting; viz count case for flatten-inside-each.

Out of scope, raised as svdfe-s6we: nested_arrow is absent from the VizModel entirely — same defect class, the other construct. Also not run: the viz Playwright harness (needs a human-launched browser); its 10 specs make no arrow-count or coverage assertions.

Totals: core 495, cli 968, lsp 292, viz 98, viz-backend 166, viz-model 6, vscode 21 golden files, tree-sitter 315/315 parses, npm run lint clean.

**2026-08-01T18:14:11Z**

Cause: coverage derived covered paths from its own CST walker, a second implementation of the traversal extract.ts already performed, so the two disagreed and four defects of the same class (relative dots, flatten-inside-each, nested_arrow, unresolved schema prefix) were each found by inspection rather than by a test.
Fix: computeMappingCoverage now consumes extract.ts's arrow output via the existing collectBodyPaths -> schemaLocalFieldPath seam and the second walker is deleted, making the defect class structurally impossible (commit cd8381d, PR #412). See ADR-035.
