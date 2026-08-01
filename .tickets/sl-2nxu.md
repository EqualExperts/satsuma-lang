---
id: sl-2nxu
status: closed
deps: []
links: [sl-vu22, sl-qzy3]
created: 2026-07-31T14:44:15Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, tree-sitter, testing]
---
# tree-sitter: corpus fixtures for fragment-spread-into-record and each-inside-flatten

PRD 38 acceptance case 30. Two gaps in the corpus let nesting defects survive:

1. No corpus fixture spreads a fragment into a record or list_of record body, though the grammar permits it (_schema_body_item includes fragment_spread) and examples/lib/sfdc_fragments.stm does it. Every '...' in the corpus is at schema or fragment top level.
2. The corpus has 'Nested flatten inside each' (each_flatten.txt:331-374) but not the mirror case, each nested inside flatten.

sl-7236's ticket identified missing corpus coverage as the reason a nesting defect survived in format.ts: 'The corpus contains no nested each blocks so round-trip tests do not catch it.' The same gap is why the coverage walker's missing flatten-inside-each went unnoticed.

## Acceptance Criteria

Corpus fixture covering a fragment spread inside a record body and inside a list_of record body; corpus fixture covering each nested inside flatten; both parse to the expected CST and the corpus suite passes with --wasm.


## Notes

**2026-08-01T19:05:38Z**

Cause: no corpus fixture spread a fragment into a record or list_of record body, and "Nested flatten inside each" had no each-inside-flatten mirror, so consumer enumeration defects in those shapes survived round-trip tests.
Fix: added both fixtures (fragments.txt, each_flatten.txt); corpus is 318/318 with --wasm (commit b4526ff).
