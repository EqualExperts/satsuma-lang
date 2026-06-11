---
id: sl-zl55
status: open
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

