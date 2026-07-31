---
id: sl-ez36
status: open
deps: []
links: [sl-hrql, sl-0zgi]
created: 2026-07-31T15:54:12Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [core, lineage, nl-refs]
---
# core: @ref to a nested source field resolves to a phantom top-level path

`resolveRef` in `tooling/satsuma-core/src/nl-ref.ts` finds nested fields but
throws away the path it found them at, so it reports a field that does not
exist.

Two branches are affected:

1. Bare ref (nl-ref.ts:546-548). `hasFieldWithSpreads` -> `hasField` recurses
   into `children`, but the result is built as `${schemaKey}.${bareName}`.
   `@city` against `schema src { address record { city ... } }` resolves to
   `::src.city`; the real field is `::src.address.city`.

2. Dotted ref (nl-ref.ts:531-533). `hasNestedFieldPath` falls back to
   `searchNestedPath`, which deliberately matches a path starting at any nested
   record, but the result is built as `${schemaKey}.${fullPath}` as written.
   `@contents.sku` against `parcels list_of record { contents list_of record {
   sku ... } }` resolves to `::src.contents.sku`; the real field is
   `::src.parcels.contents.sku`.

Both cases report `resolved: true`, so `unresolved-nl-ref` stays silent and the
bad path flows straight into lineage. The consequence is worse than a missing
edge: `field-lineage` on the real nested field reports no connection, while a
fabricated node carries the edge instead.

Reproduced across every container shape in a scratch probe — for
`schema src { hdr record { amount, vat }, contacts record { email, phone },
parcels list_of record { contents list_of record { sku, qty } } }`, all six
refs (`@amount @vat @email @phone @sku @qty`) resolved to `::src.<leaf>` and
none to their real nested path.

Confirmed in the shipped corpus: `examples/sap-po-to-mfcs/pipeline.stm:159`,
where `@MEINS` (declared at `sap_purchase_order.Items.MEINS`) resolves to
`::sap_purchase_order.MEINS`.

Note the semantic question this raises for bare refs inside `each`: a bare
`@MEINS` inside `each Items -> items` means the current element's field. The fix
should decide whether resolution becomes container-aware (prefer the enclosing
source base) or simply reports the full path of whatever field it matched.
Reporting the full path of the match is the minimum needed to stop fabricating
nodes; container-awareness additionally disambiguates a leaf name that occurs at
more than one nesting level.

Affected consumers: `nl-refs`, `field-lineage`, `graph --json`, `arrows`,
`summary --json` nl-derived counts, and `satsuma-viz-backend`'s
`resolveTransformAtRefs`.

Sibling of the target-side defect in this same walk.

## Acceptance Criteria

- `resolveRef` returns the full path from the schema root to the field it
  actually matched, for both the bare branch and the `searchNestedPath`
  fallback in the dotted branch.
- `@city` against `src { address record { city } }` resolves to
  `::src.address.city`.
- `@contents.sku` against `src { parcels list_of record { contents list_of
  record { sku } } }` resolves to `::src.parcels.contents.sku`.
- A ref that matches no field still reports `resolved: false` — the change must
  not widen the match surface.
- The chosen behaviour for a leaf name occurring at two nesting levels is
  documented at the resolution site, with a test pinning it.
- `field-lineage src.address.city --downstream` lists the target populated by
  the `@city` ref.
- Corpus regression test for `examples/sap-po-to-mfcs/pipeline.stm`
  (`@MEINS` -> `::sap_purchase_order.Items.MEINS`).

