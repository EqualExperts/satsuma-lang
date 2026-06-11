---
id: sl-th5k
status: open
deps: []
links: []
created: 2026-06-11T02:41:29Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: stale cross-file validate diagnostics never invalidated

satsuma-lsp/src/server.ts:163-176 — on save only validateDiagCache.delete(event.document.uri) runs; entries cached for OTHER files from a previous validate run are never removed when the new run no longer reports them. Fixing in file A an error attributed to file B leaves B diagnostic frozen until B itself is saved. The adjacent comment ("clear stale entries for files no longer reporting") describes behaviour the code does not implement.

## Acceptance Criteria

After a save, files no longer reporting diagnostics get them cleared (publish empty); cross-file fix test.

