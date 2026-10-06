---
id: bsw-0twy
status: closed
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

## Notes

**2026-10-06T17:22:07Z**

Cause: The grammar never made the segment after `.`, `^.` or `$.` immediate, so whitespace and comments (extras) could sit inside a path; extraction read the gap as part of the path text while the formatter joined leaf tokens and dropped it, so fmt changed what the arrow resolved to.
Fix: Per the user's decision, the grammar now rejects any gap after a path marker or continuation dot (new `_imm_path_seg`/`_path_continuation` rules, `^.` markers after the first are immediate; the space after `::` is out of scope), with seven corpus error cases, a core fast-check property over anchors, segments and gap kinds, and the rule stated in spec §4.4 and the agent grammar references. Follow-up bsw-btjl filed: the LSP formats error trees and drops ERROR text. (commit immediately after c985ca9b)
