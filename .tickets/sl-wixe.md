---
id: sl-wixe
status: open
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

