---
id: bsw-c7z2
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, namespaces]
---
# lsp: document outline shows every namespace as "(anonymous)"

`symbolName` (`tooling/satsuma-lsp/src/symbols.ts:211`) uses `labelText`, which reads `block_label`, but namespaces use `field("name", identifier)`. documentSymbol for `namespace ns { schema s1 ... }` returns `["(anonymous)", kind 3, ["s1", "s2"]]`.

## Acceptance Criteria

- Namespaces appear in the outline under their name; test added.

## Notes

**2026-10-06T10:35:00Z**

Cause: `symbolName` fell back to `labelText`, which reads a `block_label`, but the grammar names a namespace through a `name` field on a plain identifier, so every namespace showed as "(anonymous)" and its selection range covered the whole block.
Fix: A `blockNameNode` helper in symbols.ts returns the `name` field for namespaces and the `block_label` otherwise; both the symbol name and its selection range use it, with a symbols.test.js case (commit immediately after 198d2b43)
