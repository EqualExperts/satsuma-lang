---
id: sl-yedr
status: open
deps: []
links: []
created: 2026-08-05T09:25:42Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, viz, css]
---
# viz: namespaced compact card top corners go square when expanded

sz-schema-card.ts:141-147 gives `.header:first-child` the top border-radius as a fallback for when `:host([compact-expanded])` sets `overflow: visible` (the comment there explains the host's own overflow:hidden clip no longer rounds the corners once that happens). That fallback rule only fires when `.header` is the first child — i.e. only for cards with no namespace pill row above the header.

`_renderNamespacePill()` (~658-667) renders an unstyled `<div>` with no border-radius above the header when a namespace is present, and nothing gives that div the fallback top-rounding either. Net effect: a namespaced card's top corners render square, not rounded, whenever it is expanded (compact-expanded). Non-namespaced cards are unaffected because their header IS the first child.

Screenshot: bug-reports/namespaced-cards-lose-rounded-corners-on-expand.png

## Acceptance Criteria

Expanded (compact-expanded) namespaced compact cards keep rounded top corners, matching non-namespaced cards. Playwright/visual test on a namespaced card in the expanded state, both themes.

