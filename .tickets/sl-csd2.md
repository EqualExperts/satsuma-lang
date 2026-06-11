---
id: sl-csd2
status: closed
deps: []
links: []
created: 2026-06-11T02:43:01Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, grammar]
---
# grammar: src->tgt without space before arrow fails to parse (hyphen-in-identifier munch)

identifier allows hyphens (grammar.js:641 /[a-zA-Z_][a-zA-Z0-9_-]*/), so maximal munch lexes Id->opp_key as identifier "Id-" + ">" -> ERROR. Worse, "a-> b" yields a misleading src_path with text "a-" plus an ERROR. "c ->d" (space only before) parses fine. Spec 2.5 never mandates whitespace around ->. Asymmetric, surprising whitespace sensitivity.

## Acceptance Criteria

Either a->b parses as an arrow (token precedence fix) or the spec documents the whitespace requirement and the parser recovers with a clear error; corpus tests for all four spacings.


## Notes

**2026-06-11T22:38:25Z**

Cause: identifier regex allowed a trailing hyphen, so maximal munch lexed Id->opp_key as identifier 'Id-' + '>' -> ERROR, and 'a-> b' produced a misleading src_path 'a-'.
Fix: identifier (and type_expr, and the scanner's continuation_word) may contain but not end with a hyphen, so '->' always lexes as an arrow regardless of surrounding whitespace. Corpus tests for all four spacings; spec 2.2/2.5 updated. (commit 1283491)
