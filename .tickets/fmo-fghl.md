---
id: fmo-fghl
status: closed
deps: []
links: []
created: 2026-06-12T08:24:43Z
type: bug
priority: 1
assignee: Thorben Louw
---
# Viz minimap: hidden in overview mode, wrong contents in mapping detail view

In the VS Code mapping viz webview the overview mode shows no minimap, and the mapping detail view shows a minimap whose objects correspond to the full-canvas/overview content rather than the detail content. Root causes: (1) consumer page CSS (vscode viz.css, harness index.html) sets 'satsuma-viz { display: block }', which overrides the component's :host { display: flex } — outer-document rules beat :host rules — collapsing the flex chain that clamps .viewport to the visible panel; the minimap is anchored to the bottom of a content-sized viewport and is clipped off-screen whenever content is taller than the panel. (2) The detail-view branch passes this._layout (full all-schemas layout) to _renderMinimap instead of a representation of the rendered mapping-detail content.

## Acceptance Criteria

1. Overview mode shows the minimap bottom-right of the visible panel regardless of consumer CSS display overrides (internal shell owns the flex chain). 2. Mapping detail view minimap reflects the actual detail content (source cards, mapping column, target card), not the full-canvas layout. 3. Minimap click-to-pan works in both modes. 4. Node template tests cover minimap inputs per mode; harness Playwright test asserts minimap visibility in overview and detail. 5. vscode webview shell CSS sizes the component with height:100%.


## Notes

**2026-06-12T08:37:21Z**

**2026-06-12T09:45:00Z**

Cause: (1) Consumer pages (VS Code webview viz.css, playground) set `satsuma-viz { display: block }`; outer-document rules beat :host rules, collapsing the flex chain that clamps .viewport to the visible panel, so the bottom-anchored minimap rendered below the clipped fold in overview mode. (2) The mapping-detail branch passed the full-canvas ELK layout (this._layout) to _renderMinimap, so the detail minimap mirrored the overview's objects.
Fix: All render branches now wrap in a shadow-internal .viz-shell that owns the column layout (ADR-032); the minimap takes an explicit MinimapModel per view mode — overview/positioned layout nodes, or DOM boxes measured from the rendered <sz-mapping-detail> (pan/zoom-normalised) for the detail view; VS Code webview shell CSS corrected to height:100%/overflow:hidden. Verified: 96 satsuma-viz Node tests, 99 harness Playwright tests (incl. new minimap.test.ts), vscode-satsuma suite green. (commit 7ac4bbf + follow-ups)
