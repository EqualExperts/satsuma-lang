---
id: sl-vnty
status: closed
deps: []
links: []
created: 2026-06-11T02:43:01Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, grammar]
---
# grammar: missing comma between metadata entries silently swallows flags

tag_with_value value_text (grammar.js:586-611) greedily eats identifiers, including across newlines. Confirmed: "a STRING (required pii)" -> ONE tag_with_value(required, value_text(pii)) — pii gone as a flag; "b STRING (pk note \"primary key\")" -> tag_with_value(pk, value_text(...)) with NO note_tag node; multi-line "( owner finance\\n pk, required )" -> pk vanishes into the previous entry value. All parse with zero errors. Spec 2.1/7.1 treats entries as comma-separated. A forgotten comma is the most common typo here and extraction tooling misreports constraints.

## Acceptance Criteria

value_text no longer absorbs entries across the comma boundary (e.g. stop at newline, or known-constraint keywords), or the construct errors; corpus tests for the three repros; extraction tests confirm constraints reported.


## Notes

**2026-06-11T22:55:30Z**

Cause: tag_with_value's value_text greedily consumed bare identifiers, including across newlines and over structural keywords, so a forgotten comma silently folded the next flag/note entry into the previous value and extraction misreported constraints.
Fix: bare value words are now the external VALUE_WORD token — same-line only, refusing note/enum/slice and the spec-7.1 constraint flags (quoted form required to use those words as values), deferring dotted/qualified refs and booleans to the internal lexer. All three repros now error loudly; corpus pins them plus the still-valid multi-word value; spec 7.1 documents the boundary. (commit 7f4e847)
