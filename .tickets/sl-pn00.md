---
id: sl-pn00
status: open
deps: []
links: [sl-ttw0]
created: 2026-08-02T21:41:13Z
type: bug
priority: 2
assignee: Thorben Louw
---
# spec: the §4.4 nested-each example does not validate — a sibling list gets the container prefix

SATSUMA-V2-SPEC.md §4.4 (and the same code repeated in §8.2) shows:

  each POReferences -> ShipmentHeader.asnDetails {
    each LineItems -> .items {
      .ITEMNO -> .item
      Quantities.QUANTITY -> .unitQuantity
    }
  }

Every path inside a container is prefixed with the container's path (qualifyChildArrowPath in satsuma-core/src/extract.ts), unconditionally. With LineItems and Quantities declared as siblings at schema root — which is how examples/edi-to-json/pipeline.stm declares them — the example resolves to POReferences.LineItems, POReferences.LineItems.ITEMNO and POReferences.LineItems.Quantities.QUANTITY, and satsuma validate reports three field-not-in-schema warnings.

The corpus example was already rewritten to the correct form (three sibling each blocks, correlated by a note with an @ref). The spec text was not, so the normative document still teaches a shape the tooling rejects.

## Acceptance Criteria

- Reproduced: the §4.4 snippet, given a schema with sibling root-level lists, emits field-not-in-schema warnings.
- §4.4 either nests the source lists to match the example, or is rewritten to the sibling-each + positional-note form used by examples/edi-to-json.
- §8.2's copy of the same code is updated in step.
- §4.4 states the prefixing rule explicitly: a path inside each/flatten is always relative to the container, dot or no dot, and there is no notation to reach an ancestor.
- docs/nested-data/README.md §2 stays consistent with whatever the spec settles on.

