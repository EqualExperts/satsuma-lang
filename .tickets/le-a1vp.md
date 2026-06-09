---
id: le-a1vp
status: closed
deps: []
links: []
created: 2026-06-09T23:24:47Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [live-editor, viz]
---
# viz: lineage card expand/collapse must re-run layout and edge routing

Expanding a compact schema card in the lineage/overview flow only grows the canvas height; node positions and edge routes are not recomputed, so the expanded card paints over/under neighbouring cards. Expanding or collapsing a card must trigger an elk re-layout (and therefore re-routing) with the card's expanded height factored in.

## Acceptance Criteria

Expanding a compact card in lineage view re-lays-out the graph so no cards overlap (geometry assertion); collapsing re-lays-out back; edges route around the new geometry; existing compact-card tests still pass.


## Notes

**2026-06-10T00:50:00+01:00**

Cause: Compact-card expansion only grew the canvas height; the elk layout and edge routes never learned the card's new size, so expanded fields painted over/under neighbouring cards (and the canvas never shrank back).
Fix: Parent-owned _compactExpandedIds feeds computeOverviewLayout({ expandedSchemaIds }) so expanded nodes get true field-list dimensions and elk re-flows/re-routes; card overflow is CSS-driven off a reflected compact-expanded attribute; sz-compact-toggled now carries { schemaId, expanded }. Node + Playwright geometry tests added (commit e06975f)
