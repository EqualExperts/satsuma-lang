---
id: vsf-q7m2
status: closed
deps: []
links: []
created: 2026-10-06T12:56:29Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, viz-backend, mapping-detail]
---
# viz: source filters missing from the mapping header

Reported by a user: a mapping whose source carries a row filter —
`source { CustomerRecord (filter "@email IS NOT NULL") }` — renders in the
mapping detail view with its `source` and `target` chips but no `filter` chip.

The spec writes a row filter as metadata on the source ref it narrows, and
every renderer already draws `SourceBlockInfo.filters` (the detail header in
`sz-mapping-detail.ts`, the overview mapping node via `elk-layout.ts`, and the
source-block summary in `satsuma-viz.ts`). The gap is in the backend.

## Acceptance criteria

- `extractSourceBlock` returns each source ref's `filter` expression, unquoted
  and in source order.
- Unit test in `viz-model-builders.test.js` pins the extraction.
- Playwright test proves the header paints a `filter` chip per filtered source
  (`customer 360` in `multi-source-join.stm` has three).

## Notes

**2026-10-06T12:56:29Z**

Cause: `extractSourceBlock` declared a `filters` array but never filled it, so it never read the metadata block on each `source_ref` and the payload always carried no filters.
Fix: read each source ref's metadata through core `extractMetadata` and collect its `filter` values; added a unit test and a harness test for the header chips. (commit immediately after 8fd59973)
