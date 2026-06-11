---
id: sl-kilo
status: closed
deps: []
links: []
created: 2026-06-11T02:41:29Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: prepareRename placeholder/range mismatch corrupts namespaced block names

satsuma-lsp/src/rename.ts:45-48 — for a block inside a namespace the placeholder is the qualified name (a::foo) but the edit range covers only the label (foo). Accepting the prefilled placeholder and appending 2 writes a::foo2 into the label, yielding namespace a { schema a::foo2 } — a doubly-qualified corrupted name.

## Acceptance Criteria

Placeholder matches the exact text the edit range covers (bare label), or the range covers the qualified form; rename-in-namespace test.


## Notes

**2026-06-11T13:03:33Z**

Cause: prepareRename returned ctx.name as the placeholder, which findNodeContext qualifies with the namespace for block labels, while the edit range covers only the bare label node — accepting the prefilled name wrote the qualified form into the label.
Fix: prepareRename strips the namespace prefix so the placeholder is exactly the text the range covers; rename-in-namespace regression test asserts placeholder === covered text.
