---
id: sl-1qte
status: closed
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


## Notes

**2026-06-10T00:15:00+01:00**

Cause: Spike (PRD decision #8) confirmed <satsuma-viz> had no ResizeObserver — only a window-resize re-render — so a container-only resize left viewport-derived rendering (minimap rect, Fit) stale; the elk layout itself is content-driven and needs no re-layout on resize.
Fix: Host ResizeObserver in satsuma-viz (re-render on container resize, window fallback for the Node shim); harness collapse toggle narrows the source grid column to a re-expand rail, persists via the existing editor-collapsed key, and exposes editorCollapsed + editor-collapse events; collapse.test.ts asserts the reclaimed-width geometry and reload persistence (commit 378cd6e)
