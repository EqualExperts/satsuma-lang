---
id: sl-n4rb
status: closed
deps: []
links: []
created: 2026-08-03T18:41:49Z
type: bug
priority: 4
assignee: Thorben Louw
tags: [cli, lint]
---
# cli: lint --rules column alignment broken by 26-char rule ids

`satsuma lint --rules` pads rule ids with a hard-coded `padEnd(24)` (commands/lint.ts), but `unenumerated-record-target` and `type-mismatch-direct-arrow` are both 26 characters, so their description column is pushed out of alignment with the other four rows.

Introduced by sl-j30s / sl-hysg, which added the two long ids. Cosmetic only — no behaviour change.

Observed:

```
  duplicate-definition     Named definition is declared more than once in a namespace
  unenumerated-record-target Arrow targets a record without a record source or child arrows
  type-mismatch-direct-arrow Bare arrow connects fields whose declared types differ
```

## Design

Derive the column width from the registry instead of hard-coding it: `Math.max(...RULES.map(r => r.id.length)) + 1`, extracted to a named constant with a comment saying it is computed so a new rule id cannot break the table again. That removes the magic number the repo's own readability rules disallow rather than just widening it.

## Acceptance Criteria

--rules output aligns for every registered rule id; the width is computed from RULES rather than hard-coded; a test asserts alignment holds for the longest id so a future long id cannot silently regress it.


## Notes

**2026-08-03T18:57:29Z**

Cause: `lint --rules` padded rule ids with a hard-coded `padEnd(24)`, which sl-j30s/sl-hysg outgrew by adding two 26-character ids.
Fix: derive the id column width from the RULES registry (`RULE_ID_COLUMN_WIDTH`) and add a test asserting every description starts at the same column, so a future long id cannot regress the table (commit immediately after a5c221b7).
