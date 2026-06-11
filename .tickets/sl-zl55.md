---
id: sl-zl55
status: closed
deps: []
links: [sl-fm0q]
created: 2026-06-10T23:21:30Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, core]
---
# core: extractArrowRecords drops all arrows nested deeper than one level

satsuma-core/src/extract.ts:793-797 and 806-810 walk only one level: children of a top-level nested_arrow are scanned for map/computed arrows only (nested_arrow children skipped), and children of each/flatten blocks are scanned for arrows but not nested each/flatten blocks. Repro 1: "outer -> a { inner -> b { leaf -> c } }" extracts 1 arrow; inner->b and leaf->c missing. Repro 2: "each orders -> o { each items -> i { sku -> s } }" extracts only the outer each, while extractMappings().arrowCount reports 1 via allDescendants — the two extraction functions disagree on the same input. Lineage, coverage, and arrow validation are blind to deeply nested mappings.

## Acceptance Criteria

extractArrowRecords recurses to arbitrary nesting depth; agrees with extractMappings arrow counting; tests cover 3-level nested arrows and nested each/flatten.


## Notes

**2026-06-11T09:02:57Z**

**2026-06-11T08:55:00Z**

Cause: extractArrowRecords walked mapping bodies one level deep — nested_arrow children were scanned for map/computed arrows only (nested_arrow children skipped), and each/flatten bodies were scanned for arrows but not nested each/flatten blocks. All arrows below one level vanished from graph, lineage, coverage, and validation, while extractMappings.arrowCount (full-depth descendant walk) disagreed on the same input.
Fix: Replaced the single-level loops with a recursive collectArrowRecords helper; containers emit their own record and pass their absolute source/target down as path prefixes, accumulating across arbitrary depth. New arrow-records.test.js parses real source via WASM and pins 3-level nesting, nested each/flatten, mixed nesting, and count agreement with extractMappings. (commit 8e404e0)
