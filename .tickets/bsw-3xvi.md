---
id: bsw-3xvi
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, viz, enum, needs-browser]
---
# viz: enum badge overlays can stay open on several cards at once

The badge click handler calls `e.stopPropagation()` (`components/sz-schema-card.ts:775`), as do the row and overlay handlers (lines 1020, 1112). Each card closes its overlay only through a `window` click listener (lines 746-747, 767), so clicking card B's badge never reaches `window` and card A's overlay stays open. sl-2ne7 promised a second badge click replaces the overlay rather than stacking; that holds only within one card. Code-level finding; confirm in a browser: open the badge on card A, then click the badge on card B.

## Acceptance Criteria

- Opening an overlay on any card closes overlays on other cards; Playwright test with two enum cards (multi-source-join.stm has a 4-value enum).
