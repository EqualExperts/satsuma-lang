---
id: bsw-0twy
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, grammar, core, fmt, adr-053]
---
# grammar: whitespace after ^. / $. / . parses, resolves to garbage, and fmt silently changes meaning

The first `_path_seg` in `parent_path`, `root_path` and `relative_field_path` (`tooling/tree-sitter-satsuma/grammar.js`) is not `token.immediate`, so `^. oid`, `^. ^.sid`, `$. orders.oid` and `. oid` parse. `pathText` returns the raw text including the space, so validate reports `'orders. oid'`, `'orders. ^.sid'`, `' orders.oid'` as undeclared. `satsuma fmt` then rewrites them to `^.oid`, `^.^.sid`, `$.orders.oid`, which validate clean: formatting changes what the arrows resolve to.

## Acceptance Criteria

- Either the grammar rejects whitespace after a path prefix (with a corpus test for the error), or resolution uses CST segments so the spaced form means the same as the formatted one. Spec wording updated if the rule changes.
- fmt never changes resolution (add to the formatter-semantics property suite if practical).
