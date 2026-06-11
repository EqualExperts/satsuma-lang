---
id: sl-fm0q
status: closed
deps: []
links: [sl-zl55]
created: 2026-06-11T02:42:20Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz: nested each blocks excluded from hover highlighting and arrow counts

satsuma-viz/src/components/sz-mapping-detail.ts:465,489 — _findSourceFieldsForTarget/_findTargetFieldsForSource iterate m.eachBlocks[].arrows but never nestedEach, while _renderEachSection renders nested rows and forEachMappingArrow (field-coverage.ts:54-70) does recurse — card-field hover does not highlight nested-each arrow rows or counterpart fields. Also sz-overview-edge-layer.ts:216-221 and satsuma-viz.ts:1590 both skip nestedEach when counting arrows, undercounting the "N arrows" pill and edge tooltip.

## Acceptance Criteria

Hover highlighting and both arrow counters recurse into nestedEach (reuse forEachMappingArrow); nested-each test fixture.


## Notes

**2026-06-11T20:57:33Z**

Cause: _findSourceFieldsForTarget/_findTargetFieldsForSource iterated m.eachBlocks[].arrows but never nestedEach, and both arrow counters (sz-overview-edge-layer tooltip, satsuma-viz mapping pill) summed only top-level collections.
Fix: hover lookups now walk arrows via forEachMappingArrow (which recurses into nestedEach); both counters use a new shared countMappingArrows in field-coverage.ts. Regression tests use an arrow-at-every-level fixture, verified red pre-fix (commit dfa8bc5)
