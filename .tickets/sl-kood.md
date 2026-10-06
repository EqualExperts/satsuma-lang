---
id: sl-kood
status: closed
deps: []
links: []
created: 2026-03-26T07:18:45Z
type: task
priority: 2
assignee: Thorben Louw
parent: sc-k40o
tags: [docs, feature-22]
---
# Fix schema format convention doc snippets

docs/conventions-for-schema-formats/ has 13 files with stm blocks. EDI (3 blocks) and JSON (5 blocks) have parse errors because they are partial snippets (field declarations without enclosing schema block). Either wrap in minimal schema blocks or change to plain code blocks if they're intentionally fragmentary.

## Acceptance Criteria

- All stm blocks in schema format convention docs either validate cleanly or are marked as non-stm code blocks
- No false parse errors from intentionally partial snippets

## Notes

**2026-03-26T08:30:00Z**

Cause: EDI (3 blocks) and JSON (5 blocks) are intentionally partial snippets (field/record declarations without enclosing schema). They fail `satsuma validate` as standalone files.
Fix: Changed fence tag from ` ```stm ` to ` ```satsuma ` to mark them as Satsuma syntax for highlighting without implying they are complete, validatable files. All other schema format docs (11 files) validate cleanly.
