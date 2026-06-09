---
id: sl-p1r9
status: open
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

