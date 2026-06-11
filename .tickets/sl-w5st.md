---
id: sl-w5st
status: closed
deps: []
links: []
created: 2026-06-11T02:43:01Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, grammar]
---
# grammar: arrows inside computed/multi-source transform bodies silently degrade to NL pipe text

pipe_text includes hidden _arithmetic_op (-) and _comparison_op (>) tokens (grammar.js:470-481, 518-521), so src -> tgt in a pipe-chain position lexes as src,-,>,tgt and parses CLEANLY as one NL step. Confirmed in three positions: computed-arrow body "-> x { c -> d }", multi-source body "a, b -> c { d -> e }", and after a pipe step "a -> b { trim | c -> d }". Yet "a -> b { c -> d }" parses as nested_arrow — whether { c -> d } is structure or prose depends on the enclosing arrow form, with zero ERROR nodes either way. Lineage tooling silently loses edges. Spec 4.4 defines nesting via arrows; nothing says nesting under computed/multi-source arrows becomes text.

## Acceptance Criteria

Arrow syntax inside any transform body parses as an arrow node (or errors loudly) — never as clean pipe text; corpus tests for all three positions; spec updated if the resolution is to forbid.


## Notes

**2026-06-11T23:06:35Z**

Cause: pipe_text's hidden _arithmetic_op '-' and _comparison_op '>' tokens let 'src -> tgt' lex as four NL atoms in any pipe-chain position (computed-arrow body, multi-source body, after a pipe step), producing a clean tree with the arrow — and its lineage edge — silently gone.
Fix: minus is now the external minus_op token (aliased to '-') that refuses to lex when '>' follows, making an arrow in pipe text a loud parse error; nested arrows remain valid only under plain src->tgt arrow bodies and each/flatten, now documented in spec 4.4. Corpus pins all three repro positions plus minus-still-works. (commit efa5121)
