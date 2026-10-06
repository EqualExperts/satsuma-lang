---
id: bsw-r1wl
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, diagnostics]
---
# lsp: semantic diagnostics in an open file go stale when another open file changes

`documents.onDidChangeContent` (`tooling/satsuma-lsp/src/server.ts:162-171`) republishes diagnostics only for the changed URI. With `a.stm` importing `x` from `b.stm` and both declaring `schema x`, renaming `x` to `y` in b.stm (didChange) leaves `duplicate-definition` on a.stm until a.stm itself is edited. sl-th5k (closed) fixed only the CLI validate cache on save.

## Acceptance Criteria

- A change republishes workspace-level diagnostics for every open document whose result can change (at least importers / duplicates); test with two open documents.

## Notes

**2026-10-06T18:46:48Z**

Cause: every open document's semantic diagnostics read the shared workspace index (the import closure for duplicates and undefined refs, the whole folder for missing-import), but server.ts republished only the edited document after a didChange, and nothing at all after a document closed or a watched file changed on disk.
Fix: a new LSP module, src/diagnostic-refresh.ts (`DependentDiagnosticsRefresher`), republishes every other open document 150 ms after the index goes quiet, while the edited document is still published at once, as the user decided; server.ts calls it from didChange, didClose and the watched-files handler. Tested with a fake clock and end to end over stdio (new test/support/stdio-client.js), including a non-importer that gains missing-import (commit immediately after 4fa8495b)
