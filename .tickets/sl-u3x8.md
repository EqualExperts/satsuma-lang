---
id: sl-u3x8
status: closed
deps: [vnm-gucl]
links: [vnm-gucl]
created: 2026-09-29T07:27:22Z
type: feature
priority: 3
assignee: Thorben Louw
external-ref: gh-513
tags: [viz, ux]
---
# viz: pan the canvas by left-dragging empty space or Space+drag, with grab/grabbing cursors (gh-513)

From GitHub issue #513. vnm-gucl fixes the hint text (middle-mouse drag); it explicitly leaves the original interaction request for its own ticket. This is that ticket. Land vnm-gucl first, with its approved wording; this ticket revises the hint again once the new gestures exist.

## Today

`SatsumaViz._onMouseDown` (`tooling/satsuma-viz/src/satsuma-viz.ts:1921-1932`) pans only on `e.button === 1 || (e.button === 0 && e.altKey)`. Unmodified wheel/trackpad scroll already pans (`_onWheel`, :1893-1919); Ctrl/Cmd+scroll zooms. `grabbing` is set inline during a pan; there is no hover `grab` cursor, no Space handling, and `mouseleave` ends a pan. The minimap has no drag; `_onMinimapClick` only re-centres. The handlers are wired on `.viewport` at four sites (chain, detail, overview, fallback), and one component serves the harness, site playground and VS Code webview. No component binds mousedown/pointerdown/dragstart, so there is no element dragging to protect — only clicks.

## Approach

- **Left-drag on empty canvas** pans. Define "empty canvas" as concrete targets: `.viewport`, `.viewport-inner`, `.detail-inner`, and the edge-layer SVG background. Keep middle-drag and Alt+drag.
- **Space+drag** pans from anywhere, including over a card, without firing the card's click. The listener goes on `window`/`document` (the host has no tabindex, and in VS Code keys land on the webview document), ignoring editable targets, and `preventDefault` so Space does not scroll.
- **Click vs drag**: movement under a named-constant threshold is a click.
- **Pointer events + `setPointerCapture`** so a drag leaving the viewport keeps panning.
- **No text selection** from an empty-canvas drag across detail-view text (`preventDefault` on pan start).
- **Cursors** via a state-driven class: `grab` over empty canvas and while Space is held, `grabbing` during a pan.
- **Hint**: update the harness hint to the final bindings, e.g. "Ctrl+scroll to zoom · scroll or drag to pan".

## Acceptance Criteria

- Left-drag from empty canvas pans in the overview, detail and chain views.
- Clicks on cards, field rows, buttons, toggles, the enum overlay and the minimap (click-to-centre) behave as today; a left-drag starting on a card does not pan.
- Space+drag pans from anywhere and does not fire the card's click; Space typed into an input does not pan.
- Cursor is `grab` / `grabbing` as above; a drag leaving the viewport keeps panning until release.
- An empty-canvas drag across detail-view text leaves no selection.
- Middle-drag, Alt+drag, wheel pan and Ctrl/Cmd+scroll zoom unchanged.

## Tests

A unit test cannot observe pan offsets after a real gesture, computed cursors, suppressed clicks or the live minimap, so Playwright is required. Add `describe("Canvas panning")` to `tooling/satsuma-viz-harness/test/harness.test.ts` using `page.mouse` and `page.keyboard.down("Space")`, asserting: `.viewport-inner` transform changes after an empty-canvas drag and not after a card click; the card's click effect does not happen under Space+drag; computed cursor goes `grab` → `grabbing`; `.minimap-viewport` `left`/`top` change between `mouse.move` steps; `window.getSelection().toString() === ''` after a drag across text. Existing overview/detail fixtures suffice; click toolbar Fit first on small graphs (sv-embb). Unit-test the threshold and target classification if extracted as pure helpers. The harness must run green on Linux (CI or container) — headless Chromium segfaults in the macOS agent session.

## Notes

**2026-10-06T15:00:00Z**

Cause: the viz only panned on middle-drag or Alt+drag, with no cursor cue, so left-drag did nothing and #513's reporter fell back to the minimap.
Fix: new pan-gesture.ts decides which presses pan (allow-list of background classes per view, matched on the innermost composed-path element); SatsumaViz switched to pointer events with pointer capture, a window-level Space hand tool armed only while the pointer is over the viewport and not while typing, and a transparent overlay during Space/panning that carries the grab/grabbing cursor, swallows the card click and blocks text selection. Harness hint updated; 8 Playwright tests in "Canvas panning (sl-u3x8)", 6 checked to fail against the old code. (commit immediately after 631e9605)

Deviation from the approach: no click-versus-drag threshold. Nothing on the canvas background has a click handler, and the overlay already stops Space+drag clicking a card, so a threshold would have been dead code. Add one if a background click behaviour is ever introduced.
