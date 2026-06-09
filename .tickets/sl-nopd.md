---
id: sl-nopd
status: closed
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


## Notes

**2026-06-10T00:30:00+01:00**

Cause: Feature work — the playground previously had no way to load a local .stm or get the buffer back to disk; PRD §3–4 require both to be entirely client-side.
Fix: Open… reads the chosen file in-browser (File.text()) and adds it to the library as a user document whose name becomes the label; Save downloads the live buffer as a Blob named per the PRD §4 default chain. open-save.test.ts asserts zero network requests during Open, "Your documents" placement, and byte-exact downloads (commit b506b34)
