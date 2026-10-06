---
id: bsw-c7z2
status: open
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
