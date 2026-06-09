---
id: sl-1qte
status: open
deps: [sl-p1r9]
links: []
created: 2026-06-09T21:14:51Z
type: task
priority: 2
assignee: Thorben Louw
tags: [live-editor, harness]
---
# Feature 33 — collapsible editor pane with viz reflow

Add a toggle that collapses the source pane to a thin rail/re-expand handle so the visualization can use the full width, and expands it back. Collapsing must REFLOW the viz to the reclaimed width (not overlay it), and the collapsed/expanded state persists in localStorage across reloads.

## Design

SPIKE FIRST (PRD open decision #8): confirm whether <satsuma-viz> already relayouts on container resize (ResizeObserver). If it does not, collapse/expand must explicitly trigger an elkjs relayout.

## Acceptance Criteria

source pane collapses to the left and re-expands; the viz canvas widens and re-lays-out on collapse (geometry assertion that the canvas width increases), not merely overlaid; collapsed/expanded state survives a reload via localStorage.

