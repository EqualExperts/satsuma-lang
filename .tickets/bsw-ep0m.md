---
id: bsw-ep0m
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, fragments]
---
# cli: field-scoped commands reject nested fields that come from a fragment spread

```satsuma
fragment audit { created_by STRING }
schema src {
  ...audit
  orders list_of record { ...audit  oid STRING }
}
schema tgt { rows list_of record { a STRING  c STRING } }
mapping m { source { src } target { tgt } each orders -> rows { .created_by -> .a  .oid -> .c } }
```

`satsuma arrows src.orders.created_by` gives "Field 'orders.created_by' not found in schema 'src'"; so do `field-lineage`, `nl` and `meta`. Yet `fields src` lists it, `validate` accepts arrows to it, and the top-level `src.created_by` works. The field lookup in these commands (`findFieldByPath` in `satsuma-cli/src/commands/arrows.ts` and siblings) does not expand spreads inside nested records.

## Acceptance Criteria

- arrows, field-lineage, nl and meta find spread-provided fields at any nesting depth, sharing one spread-aware lookup (core if the LSP needs the same).
