---
id: sl-vnty
status: open
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

