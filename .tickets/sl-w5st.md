---
id: sl-w5st
status: open
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

