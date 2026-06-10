---
id: sl-q9oj
status: closed
deps: []
links: []
created: 2026-06-10T22:04:41Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [formatter, core]
---
# Formatter drops commas between source refs in multi-line source blocks

(Issue c) Reformatting a mapping whose source block has multiple refs removes the commas between them.

Root cause: formatSourceBlock in tooling/satsuma-core/src/format.ts:629-657 — the single-line path joins items with ', ' (line 647) but the multi-line path joins with bare newlines (line 656: items.map(item => ind(indent+1) + item).join('\n')), so 'source { a, b }' reflowed to multi-line loses its commas. Multi-ref sources are always forced multi-line (line 650), so every multi-source mapping is affected.

Verify against grammar/spec whether commas are required separators between source_refs (if required, formatter output is invalid syntax; if optional, output still parses but the formatter is not style-preserving/canonical). Fix: emit trailing commas on all but the last item in the multi-line branch, matching the canonical examples corpus. Check formatTargetBlock for the same defect while there.

## Acceptance Criteria

Formatting 'source { store, customers }' (or its multi-line form) preserves commas between refs; output reparses cleanly and formatting is idempotent. Unit test covers multi-ref multi-line source block, and target block if it shares the bug.


## Notes

**2026-06-10T22:07:44Z**

Cause: the multi-line branch of formatSourceBlock (satsuma-core/src/format.ts) joined source refs with bare newlines, dropping the commas the author wrote; the single-line branch used ', '. Commas are optional in the grammar so output still parsed, but formatting was not style-preserving and diverged from the canonical corpus style.
Fix: multi-line source blocks now emit a trailing comma on every ref except the last, matching the single-line style; added regression tests for comma preservation and idempotency in satsuma-core/test/format.test.js.
