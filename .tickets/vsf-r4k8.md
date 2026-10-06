---
id: vsf-r4k8
status: open
deps: [vsf-q7m2]
links: [vsf-q7m2]
created: 2026-10-06T14:10:00Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, viz-model, viz-backend, mapping-detail, overview]
---
# viz: tie each source filter to the source schema it narrows

vsf-q7m2 made source filters reach the visualiser, but as a flat list:
`SourceBlockInfo.filters` is `string[]`. The filter's owner — the source ref
it is written on — is lost, so with more than one source the reader cannot
tell which schema a filter narrows.

```satsuma
source {
  `crm_customers` (filter "email NOT LIKE `%@test.internal`"),
  `order_transactions` (filter "status IN (`completed`, `refunded`)"),
  `support_tickets` (filter "created_at >= date_sub(now(), interval 12 month)"),
}
```

**Where it shows.**

- **Mapping detail header** (`sz-mapping-detail.ts`, `_renderMappingHeader`):
  three `filter` chips sit below all the `source` chips with no link to them.
- **Overview** (`satsuma-viz.ts`, `_renderSourceBlock`): every filter is drawn
  in a stack beside the *first* source card, so `support_tickets`' filter
  appears next to `crm_customers`. The layout copy in `elk-layout.ts`
  (`SourceBlockLayout.filters`) carries the same flat list.

**Ownership rule.** In the grammar a filter is metadata on one `source_ref`, so
each filter belongs to exactly one schema — the one it is written on — even
when its expression mentions others through `@refs`. A schema may carry more
than one filter. A filter that genuinely spans several sources is written in
the join prose (`"Join ... where ..."`) and stays part of `joinDescription`;
this ticket does not try to split that prose.

**Suggested shape.** Change the VizModel contract so each filter carries its
owner, e.g. `filters: { schema: string; expression: string }[]`, with `schema`
resolved the same way `schemas` is in `extractMapping` (qualified id). Any
shape is fine if a renderer can place a filter against its schema without
parsing text. This is a contract change in `@satsuma/viz-model`; check whether
it needs an ADR.

## Acceptance criteria

- `extractSourceBlock` records, for every filter, the source schema it is
  declared on (resolved id), in source order. Unit test with two filtered
  sources and one unfiltered source.
- Mapping detail header shows each filter with its own source — e.g. inside or
  directly under that source's chip — so a reader can see which schema it
  narrows.
- Overview draws each filter beside its own source card, not the first one.
- Playwright: extend "Mapping detail — source filters in the header" in
  `harness.test.ts` to assert each `customer 360` filter is attached to its
  source, and add an overview case asserting each filter sits beside the right
  card (compare bounding boxes).
- All consumers of `SourceBlockInfo.filters` and `SourceBlockLayout.filters`
  updated; integration-tests parity sweep still green.
