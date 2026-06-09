---
id: sl-nopd
status: in_progress
deps: [sl-p1r9]
links: []
created: 2026-06-09T21:14:51Z
type: task
priority: 2
assignee: Thorben Louw
tags: [live-editor, harness]
---
# Feature 33 — open and save local .stm files (client-only)

Add Open and Save toolbar actions that are entirely client-side — file content is never uploaded. Open: read a chosen .stm via <input type=file accept=.stm,.txt> + FileReader (or File System Access API where available with the input fallback); the text REPLACES the editor buffer and the viz re-renders; the chosen filename becomes the current document label. Save to local: download the current buffer as a Blob (anchor download, or FSA save picker with anchor fallback) with a default filename derived from the document label (opened name, fixture-derived name, or untitled.stm).

## Design

File System Access API is Chromium-only; Firefox (the Playwright browser) exercises the <input>/anchor fallback path, so that path must be the tested one. Opening a local file adds a user document to the localStorage library (see library ticket) distinct from built-in examples.

## Acceptance Criteria

Open loads a chosen .stm into the editor and re-renders using only client-side file reading (no upload request); the filename shows as the current document label; Save downloads the current buffer as a .stm with a sensible default name, entirely client-side.

