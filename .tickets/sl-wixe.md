---
id: sl-wixe
status: closed
deps: []
links: []
created: 2026-06-10T07:18:42Z
type: bug
priority: 1
assignee: Thorben Louw
parent: sl-ubbp
tags: [viz, layout]
---
# Overview edges flush on cards, centred on header; kill filler bar (R2)

Three confirmed defects (PRD P2/P2b): (1) overview edge SVG mounted at left:24px;top:0 while cards sit inside the canvas's 24px padding (satsuma-viz.ts:1402-1411) — all edges draw 24px too high; (2) overviewVisualAnchor (elk-layout.ts:977-987) assumes the header starts at node top, but compact cards always render a 24px top bar; (3) non-namespaced compact cards render a 24px empty orange filler bar (_renderNamespacePill compact branch in sz-schema-card.ts) that compactHeight() doesn't count — cards overflow their ELK bounds and headers look bloated.

## Acceptance Criteria

Edge layer and card layer share one coordinate origin by construction; anchor dots within ~1px of the card border at the visible header's vertical midpoint for namespaced, non-namespaced, and mapping nodes; no filler bar — non-namespaced compact card height equals its ELK node height and the header owns the rounded corners; shared geometry constant across overviewVisualAnchor/compactHeight/_renderNamespacePill; Playwright tests cover namespaced + non-namespaced cards in both themes.


## Notes

**2026-06-10T08:02:19Z**

Cause: three divergent copies of card-chrome geometry — edge SVG mounted at top:0 beside in-flow cards inside 24px canvas padding; 24px orange filler bar on non-namespaced compact cards invisible to compactHeight(); mapping pills padded +24px while layout reserved pill height unconditionally.
Fix: edge layers moved inside .card-layer (shared origin by construction); filler bars removed from schema/metric/fragment cards with header owning top rounding; header + pill row pinned to shared constants in new layout/geometry.ts; mapping nodes sized to their ELK node height. 3 layout unit tests + 5 Playwright tests (anchors both themes both fixture kinds, chrome contract). Verified 86/86 watcher run 08:56.
