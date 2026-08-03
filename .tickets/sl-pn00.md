---
id: sl-pn00
status: closed
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

## Notes

**2026-08-03T06:35:00Z**

Cause: §4.4's example nested `each LineItems` inside `each POReferences` while the EDI schema it was drawn from declares POReferences, LineItems and Quantities as siblings at the schema root. Because qualifyChildArrowPath prefixes every path inside a container unconditionally, the example resolved to POReferences.LineItems.* and produced three field-not-in-schema warnings. The corpus example had already been rewritten to sibling each blocks; the spec had not.
Fix: rewrote §4.4 around a source whose `lines` list is genuinely declared inside its `orders` list, so nested `each` is demonstrated by a shape that validates; added an explicit statement of the prefixing rule with a resolution table (including the ancestor case that resolves to nothing) and the fact that there is no notation for reaching an ancestor; added the sibling-each + positional-note form for lists declared side by side, pointing at §8.2. §8.2's copy of the code now matches examples/edi-to-json/pipeline.stm — three sibling each blocks with @ref notes — with a comment explaining why it is not nested. Both rewritten snippets verified with validate, coverage and lint (100%/100%, no findings).
docs/nested-data/README.md §2 already taught the same rule and stays consistent; §9 continues to track the missing ancestor notation as sl-8vqk.
