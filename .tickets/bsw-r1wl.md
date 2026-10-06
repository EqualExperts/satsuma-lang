---
id: bsw-r1wl
status: open
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
