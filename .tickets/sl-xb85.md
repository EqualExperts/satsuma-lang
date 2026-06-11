---
id: sl-xb85
status: closed
deps: []
links: []
created: 2026-06-11T02:43:01Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, grammar]
---
# grammar: multiline string cannot end with a quote character

multiline_string regex /"""([^"]|"[^"]|""[^"])*"""/ (grammar.js:645) cannot match content whose final char is " (or ""). Repro: note { """He said "hi"""" } -> token closes early after hi and the trailing quote ERRORs. Spec 2.2 claims triple-quoted strings need no escaping for inner quotes — false at the end-of-string boundary.

## Acceptance Criteria

Content ending in one or two quotes parses (regex or external scanner fix); corpus tests; or spec documents the limitation.


## Notes

**2026-06-11T22:34:09Z**

Cause: the multiline_string token regex could not match content whose final characters are one or two quotes, so the token closed early and the trailing quote produced an ERROR — contradicting spec 2.2's no-escaping claim.
Fix: regex now allows an optional one- or two-quote run before the closing delimiter; content ending in three+ quotes remains impossible and is documented as a limitation in spec 2.2. Corpus tests for both endings. (commit 211e4dc)
