---
id: le-a1vp
status: open
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

