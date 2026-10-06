---
id: bsw-9iz0
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, rename]
---
# lsp: rename accepts names that need backticks, or an empty name, and writes unparseable files

`computeRename` (`tooling/satsuma-lsp/src/rename.ts:58`) does no validation or quoting. Renaming `` `raw cust` `` to `new cust` writes `schema new cust {`, `source { new cust, ... }` and `@new cust.id`. Renaming to `""` deletes the name everywhere (`schema  {`, `@.street`).

Related: `computeRename` does not apply `prepareRename`'s renameable-kind gate. prepareRename is optional for LSP clients, so a client that skips it can rename a field, which edits same-named fields in other schemas but never the declaration.

## Acceptance Criteria

- Rename rejects an empty or otherwise invalid name with an LSP error, and backtick-quotes names that need it (consistently at declarations, references and @refs).
- computeRename enforces the same kind gate as prepareRename.
- Tests for both.
