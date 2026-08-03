---
id: sl-zsv6
status: open
deps: []
links: []
created: 2026-08-03T12:30:34Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [viz, ui]
---
# viz toolbar: title wraps to two lines and the trailing file filter is clipped at 1440px

With the full toolbar rendered (title, Show File Notes, Fit, Refresh, Export SVG, namespace filter, file filter) the title '(*) Mapping Viz' breaks onto two lines ('Mapping' / 'Viz') and the trailing 'All files' select is pushed past the right edge. Observed in the harness at its default 1440x900 viewport with the source pane open, on examples/namespaces/ns-platform.stm (the fixture that renders the most toolbar controls, because namespace and file filters both appear).

Root cause is in satsuma-viz/src/satsuma-viz.ts: .toolbar (line 465) is display:flex with no flex-wrap and no overflow handling. .toolbar-btn (line 494) sets white-space:nowrap so the buttons hold their width, but .toolbar-title (line 479) sets neither white-space:nowrap nor flex-shrink:0. The title is therefore the only flex item that can absorb the overflow, so it shrinks and wraps while the last select overflows the container.

This is the viz component's own toolbar, so it affects the VS Code webview and the site playground at narrow widths too, not just the harness.

## Acceptance Criteria

- .toolbar-title does not wrap: it keeps one line at every viewport width.
- The trailing file filter stays inside the toolbar's box, or the toolbar scrolls/collapses deliberately rather than overflowing.
- A Playwright assertion covers it: at 1440x900 with the source pane open on ns-platform.stm, the title element's scrollHeight equals a single line height and the last toolbar control's right edge is within the toolbar's client box.
- Verified in both light and dark themes.

