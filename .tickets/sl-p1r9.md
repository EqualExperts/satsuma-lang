---
id: sl-p1r9
status: closed
deps: [sl-dn29]
links: []
created: 2026-06-09T21:14:51Z
type: task
priority: 1
assignee: Thorben Louw
tags: [live-editor, harness]
---
# Feature 33 — editable, highlighted source pane with live re-render

Replace the read-only <pre id=source-code> with an editable, syntax-highlighted buffer using the zero-dependency overlay (transparent textarea over a <pre> rendered by the existing highlightSatsuma, synced scroll). The buffer is the single source of truth for highlighting and the model pipeline. Long lines scroll left/right (no wrap) with highlight+caret aligned at any scroll offset. Edits trigger a debounced (~150-300ms) model-pipeline rebuild. Invalid/empty intermediate buffers keep the last good visualization and show a small dismissable parse-status indicator instead of clearing the canvas.

## Design

Highlight layer and editable layer share white-space:pre and one horizontal scroll region so colours and caret stay aligned. Highlighting stays synchronous (cheap regex); model-building is deferred to idle. CodeMirror 6 remains the documented fallback.

## Acceptance Criteria

left pane is editable and highlighted via highlightSatsuma with highlight aligned to caret while typing; wide lines scroll horizontally with highlight+caret aligned at non-zero offsets (geometry assertion); edits re-render the viz on a debounce; an invalid intermediate buffer retains the last good viz and shows a parse-status indicator rather than blanking the canvas.


## Notes

**2026-06-09T22:31:42Z**

2026-06-09T00:00:00Z

Cause: The left source pane was a read-only <pre>; the playground needs an editable buffer that drives highlighting and the model pipeline.
Fix: Added a zero-dependency overlay editor (src/client/editor.ts: transparent textarea over a highlightSatsuma-rendered <pre>, scroll-locked) and extracted the tokenizer to src/client/highlight.ts. app.ts now mounts the editor, treats the buffer as the single source of truth, updates documentSources per edit, and rebuilds the model on a 200ms debounce. Empty/invalid buffers retain the last good VizModel and reveal a dismissable #parse-status indicator (harness.parseStatus) instead of blanking the canvas. Covered by test/editor.test.ts (editable+highlight tracking, horizontal-scroll geometry alignment at non-zero offset, debounced re-render, resilience). 65/65 Playwright tests pass.
