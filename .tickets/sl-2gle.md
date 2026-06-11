---
id: sl-2gle
status: open
deps: []
links: []
created: 2026-06-11T02:43:02Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, grammar]
---
# grammar: corner-case batch — empty mapping body, fragment/transform metadata, lexical edge cases

Confirmed small issues. (1) mapping m { } ERRORs (mapping_body is repeat1, grammar.js:153) while schema/transform accept empty bodies; corpus lexical.txt even snapshots bare (ERROR) trees under the misleading names "Mapping block with/without label". (2) fragment f (note "x") and transform t (note "x") reject metadata that schema/mapping accept (grammar.js:121-139 lack optional metadata_block); spec 2.1 describes metadata generically. (3) "(,)" parses cleanly as empty metadata_block. (4) pipe_text atom set is closed: { value % 100 } and { rate = 0.5 } ERROR despite spec 2.7/7.2 framing pipe content as open NL. (5) map keys cannot contain negative numbers (< -5: "low" ERRORs). (6) classic-Mac CR-only line endings: scanner.c treats \\r as horizontal whitespace so a following field is swallowed into a 3-word spread, clean parse.

## Acceptance Criteria

Each item either fixed with corpus coverage or explicitly documented as invalid in the spec; the mislabeled lexical.txt snapshots corrected.

