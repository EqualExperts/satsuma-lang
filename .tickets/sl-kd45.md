---
id: sl-kd45
status: in_progress
deps: [sl-dn29, sl-p1r9, sl-c6r7]
links: []
created: 2026-06-09T21:14:51Z
type: task
priority: 1
assignee: Thorben Louw
tags: [live-editor, harness]
---
# Feature 33 — localStorage document library + in-browser workspace + cross-file lineage

Build the client-only persistence layer around a single localStorage document library that doubles as the playground example browser. On first load (library version key absent) seed from the bundled examples JSON. Build the in-browser WorkspaceIndex from the library entries so imports between seeded documents resolve and lineage renders cross-file with no server; editing a document updates both its library entry and the workspace so lineage stays live. localStorage holds: the document library (each example as an editable entry keyed by file:/// URI), active-document pointer, current buffer, view-mode, editor collapsed/expanded state, and librarySeedVersion. Re-seeding on a version bump only adds new/updated built-ins and never overwrites a user-edited document. Per-document 'Restore original' re-copies one example from the bundled JSON; global Reset restores the whole library and clears the buffer. Opening a local file / untitled buffer adds a user document distinguished from built-ins. Blank-slate fallback: a small bundled starter .stm so the canvas is never blank.

## Design

Library = workspace: the WorkspaceIndex (resolver + file:/// URIs) is built from library entries. A buffer importing a path NOT in the library renders single-file with a visible note naming the unresolved import (v1 does not fetch external paths). Guard localStorage writes and surface a non-blocking warning on the (unlikely) quota error.

## Acceptance Criteria

first load seeds the bundled examples into the localStorage library and the picker lists them; opening one loads it into the editor; an example that imports another library document renders cross-file lineage edges with no network model call; a returning visit does not re-seed over a user-edited document and the edit survives reload; active buffer + collapsed/expanded state restore on reload; global Reset restores the corpus and per-document Restore original re-copies one example; no server-side storage exists.

