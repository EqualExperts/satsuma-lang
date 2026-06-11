---
id: sl-zzaj
status: open
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

