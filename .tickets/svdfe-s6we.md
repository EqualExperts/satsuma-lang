---
id: svdfe-s6we
status: closed
deps: []
links: [sl-vu22, 3cdd-yavi]
created: 2026-07-31T16:23:49Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, viz-model, coverage]
---
# viz-model: nested_arrow blocks are absent from the model, so their arrows are invisible to viz

The VizModel has EachBlock and FlattenBlock but no representation of nested_arrow (grammar.js:404-414) — the braced 'src -> tgt { .a -> .b }' form. viz-model.ts's buildMappingBlock switches on each_block and flatten_block only, so a nested_arrow and every arrow inside it is dropped from the model.

Same defect class as sl-vu22 (flatten inside each) and sl-qzy3 (nested_arrow missing from the core coverage walk): a consumer enumerating the block types it knows about, falling out of step with the grammar's shared _nested_block_item production. Found while fixing sl-vu22, which corrected the each/flatten half; nested_arrow was out of that ticket's scope.

## Impact

Every viz surface that reads arrows undercounts a mapping using nested_arrow: the 'N arrows' header, the mapping-detail arrow table, hover cross-highlighting, and — once feature 36 lands — the coverage overlay, which will disagree with 'satsuma coverage --json' (core resolves nested_arrow correctly since sl-qzy3). Feature 36's R6 parity test would fail on any fixture using the construct.

The corpus contains no nested_arrow inside a mapping body that viz renders, which is why round-trip tests do not catch it — the same reason named in sl-7236 and sl-vu22.

## Acceptance Criteria

VizModel represents nested_arrow blocks with their src/tgt and nested contents, reusing the shared nested-block collector added for sl-vu22 rather than adding a third enumeration; countMappingArrows and forEachMappingArrow visit them; sz-mapping-detail renders them as a scope section; a viz-backend test asserts a nested_arrow's arrows survive extraction; a corpus/example fixture exercising nested_arrow inside a mapping exists so round-trip tests cover it.


## Notes

**2026-08-01T19:05:38Z**

Cause: VizModel had no representation of nested_arrow; buildMappingBlock and the shared nested-block collector enumerated each_block/flatten_block only, so the block and all arrows inside it were dropped from every viz surface.
Fix: added NestedArrowBlock to the model (same nesting collections as each/flatten, built by the shared collector), walked it in forEachMappingArrow/countMappingArrows and the mapping-detail scope sections, and unified the elk edge collection over all three container kinds — which also fixes its pre-existing miss of edges under flatten-inside-each. Corpus gains a mapping-body nested_arrow fixture (commit 0ebead6).

**2026-08-01T21:19:37Z** (correction, from PR #414 review)

The original note over-claimed: hover cross-highlighting and overview edges are
NOT fixed for the canonical relative-path form (.line1 -> .line1) — those
surfaces resolve authored paths via resolveSchemaLocalFieldPath, which returns
null for dot-relative text, so relative child arrows still contribute no
coverage, no hover matches and no edges. What this ticket delivered: the model
representation, arrow counts, and the detail-view scope section. The unified
elk recursion is correct but only observable for absolute-path arrows until
relative paths are qualified — raised as 3cdd-yavi (reuse core's qualification
rule from extract.ts rather than a viz-local copy).
