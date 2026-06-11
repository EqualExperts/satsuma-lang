---
id: sl-zzaj
status: closed
deps: []
links: []
created: 2026-06-11T02:43:01Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, grammar]
---
# grammar: bare multi-word map values garble subsequent entries

map_value is prec.left(repeat1(...)) (grammar.js:524-535) so it reduces after one token; leftover words join the NEXT key. Repro: map { R: retail customer\\n B: "business" } -> entry 1 R: retail; entry 2 key "customer B" (spanning two lines) with value "business". Clean parse, no errors. Spec 4.3 examples use quoted values but bare NL values fit the language philosophy; corpus recovery.txt already snapshots a related key/value boundary confusion.

## Acceptance Criteria

Bare map values extend to end of line (or are rejected); subsequent entries unaffected; corpus tests for multi-word bare values.


## Notes

**2026-06-11T23:00:55Z**

Cause: map_value was prec.left(repeat1(...)) so it reduced after one token; leftover words of a bare multi-word value were folded into the NEXT map_entry's key, spanning lines and garbling subsequent entries with zero errors.
Fix: map_value = one leading atom + same-line continuation words via the new external MAP_VALUE_WORD token (newline ends the value; next line starts a new entry). Same-line entries without a comma now error loudly. Spec 4.3 updated; corpus tests for the repro, digit/dotted continuations, and the comma rule. (commit 829bb7b)
