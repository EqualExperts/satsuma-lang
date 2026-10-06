---
id: bsw-h3qg
status: open
deps: []
links: [bsw-2yzd]
created: 2026-10-06T17:03:51Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, core, paths]
---
# core: joined field-path identity cannot tell a dotted backtick field from nesting

A resolved arrow path is identified by its joined text (ADR-035), so `` `a.b` `` and a nested `a { b }` both read as "a.b". bsw-2yzd made `^.` resolution segment-based, but several core helpers still re-split the joined identity on `.`: coverage.ts (~641), coverage-paths.ts (~127), field-utils.ts (~28), validate.ts `extractReferencedSchema` (~550) and lint-type-mismatch.ts (~322). Under a backtick field whose name contains a dot, each can look up the wrong field or none.

```satsuma
schema src { `line.items` list_of record { v STRING }  line record { items record { v STRING } } }
```

Here "line.items.v" names two different fields.

## Acceptance Criteria

- Decide (ADR) whether path identity carries segments or an escaped join, and update the helpers above to use it.
- A schema holding both `` `line.items` `` and `line { items }` validates, covers and lints each field independently.
