---
id: sl-qzy3
status: closed
deps: []
links: [sl-2nxu]
created: 2026-07-31T14:47:17Z
type: bug
priority: 1
assignee: Thorben Louw
external-ref: gh-405
tags: [coverage, core, cli, feature-35]
---
# coverage: flatten-inside-each and nested_arrow are not walked — wrong percentages and a fields --unmapped-by regression

computeMappingCoverage does not walk two nesting constructs the grammar permits, so it reports explicitly-mapped fields as uncovered. Found while reviewing PR #405 (feature 35) at 47438ac.

1. flatten_block nested inside each_block: the each child loop handles map_arrow, computed_arrow and each_block but not flatten_block, and collectFlattenPaths handles no nested blocks at all — though _nested_block_item (grammar.js:265-270) permits arbitrary interleaving.
2. nested_arrow (grammar.js:404-414) is absent from the collectBodyPaths switch entirely, so 'addr -> address { .street -> .street_line }' contributes nothing on either side.

## Impact 1 — the flagship command's first nested output is wrong

examples/nested-iteration/pipeline.stm is the repo's canonical nested example and is FULLY mapped. On the branch:

    $ satsuma coverage examples/nested-iteration/pipeline.stm
      source  ::warehouse_dispatch_events      6/9   67%
      target  ::dispatch_manifest_json         6/8   75%
        uncovered in target: orders.packed_items.sku, orders.packed_items.units
        uncovered in source: orders.parcels.contents.sku, orders.parcels.contents.units (+ barcode, genuine)

Truth: target 8/8 = 100%, source 8/9 = 89% (orders.parcels.barcode is the single real gap). So 'satsuma coverage --fail-under 90' fails a fully-mapped spec on the example the repo ships to demonstrate nested iteration — the gate's most visible failure mode, since it errs toward blocking correct work.

## Impact 2 — regression in a shipped command

fields --unmapped-by was CORRECT before sl-oqsj re-based it onto the core function, because it derived paths from extract.ts, which walks every construct uniformly and strips relative dots at :911-921.

    main:   orders.parcels.barcode                                    (correct)
    branch: orders.parcels.barcode, contents.sku, contents.units      (wrong)

Note for the record: the re-basing was recommended in the feature 35 doc review to stop two commands answering the same question from separate code. That recommendation was right in intent but was made without knowing the core walker had this defect — it moved a correct consumer onto a defective shared path. The re-basing should stay; the walker needs fixing.

## Design

Two options, and the choice is the substantive one:

(a) Patch the walker — add nested_arrow to collectBodyPaths and recurse on the shared _nested_block_item production rather than enumerating permitted children per parent, so future grammar additions cannot silently fall through again.

(b) Derive covered paths from extract.ts's arrow output instead of walking the CST a second time. extract.ts already handles every construct uniformly and is the reason the CLI was correct before the re-base. This deletes the duplicate walker and this whole class of defect.

(b) is the better end state and is tracked as sl-vu22 under feature 38, which also carries the architectural decision. This ticket is the minimum fix needed to make PR #405's numbers correct — take (a) here if (b) is not ready, but do not ship the PR with the canonical example reporting 75%.

Related: sc-xnxp (closed) was the same defect class — relative .field paths producing 'items..id' — found and fixed during this branch. sl-7236's ticket named the reason these survive: 'The corpus contains no nested each blocks so round-trip tests do not catch it.' Corpus gaps are tracked as sl-2nxu.

## Acceptance Criteria

computeMappingCoverage walks flatten_block inside each_block, each_block and flatten_block inside flatten_block, and nested_arrow at every level. satsuma coverage on examples/nested-iteration/pipeline.stm reports target 8/8 100% and source 8/9 89% with orders.parcels.barcode the only uncovered leaf — percentages asserted, not just booleans. fields --unmapped-by on the same example reports only orders.parcels.barcode, matching main's pre-regression output. A nested_arrow fixture (nested-arrow-lookup.stm shape) reports its written paths covered. Regression tests live in satsuma-core/test/coverage.test.js alongside the sc-xnxp locks. CLI, core and LSP suites pass.


## Notes

**2026-07-31T15:02:27Z**

Cause: collectBodyPaths and the each/flatten child loops enumerated the node types each parent accepted, but the grammar's _nested_block_item lets each/flatten/nested_arrow interleave to any depth — so flatten inside each, any block inside flatten, and nested_arrow anywhere were never walked, and their arrows contributed no coverage.
Fix: replaced the three hand-rolled loops with one recursive walk (collectBlockItemPaths/collectContainerPaths) that treats all three container types uniformly and threads accumulated src/tgt bases down, mirroring extract.ts's proven contract. flatten keeps its schema-root target rule, now decided by whether its tgt_path is an authored relative_field_path — which is also what makes a nested 'flatten x -> .field' base correctly. examples/nested-iteration/pipeline.stm now reports target 8/8 100% and source 8/9 89% (barcode only), and fields --unmapped-by agrees with coverage again.
