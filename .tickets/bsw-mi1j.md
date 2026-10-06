---
id: bsw-mi1j
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, viz, pan, a11y, needs-browser]
---
# viz: Space-to-pan swallows Space on a focused button while the pointer is over the canvas

`_onWindowKeyDown` (`tooling/satsuma-viz/src/satsuma-viz.ts`, around lines 2053-2059, from 49e2a125 / sl-u3x8) calls `preventDefault()` whenever the pointer is over the viewport and focus is not a text field. With focus on a `<button>` (toolbar, a field's lineage button), the cancelled keydown means keyup fires no click; the pan cursor appears instead. Code-level finding; confirm in a browser: Tab to a toolbar button, rest the mouse over the canvas, press Space.

## Acceptance Criteria

- Space activates a focused button or other focusable control; the exclusion lives in `pan-gesture.ts`; Playwright test.
