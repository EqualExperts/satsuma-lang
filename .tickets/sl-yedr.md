---
id: sl-yedr
status: closed
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


## Notes

**2026-08-06T12:42:05Z**

**2026-08-06T12:42:00Z**

Cause: `.header:first-child` was the only rule giving a compact card its top rounding once `:host([compact-expanded])` drops the host's overflow clip, and a namespaced card's pill row sits above the header, so the header is not first and no rule fired.
Fix: the pill row's geometry moved from an inline style into a `.namespace-pill-row` class that carries the same top-rounding fallback under `:first-child`; covered in chrome-layout.test.ts in both themes, and proved to fail without the fix (commit immediately after 5f59ffc6).
