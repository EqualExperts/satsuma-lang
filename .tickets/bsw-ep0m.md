---
id: bsw-ep0m
status: closed
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
  orders list_of record {
    ...audit
    oid STRING
  }
}
schema tgt { rows list_of record { a STRING  c STRING } }
mapping m { source { src } target { tgt } each orders -> rows { .created_by -> .a  .oid -> .c } }
```

`satsuma arrows src.orders.created_by` gives "Field 'orders.created_by' not found in schema 'src'"; so do `field-lineage`, `nl` and `meta`. Yet `fields src` lists it, `validate` accepts arrows to it, and the top-level `src.created_by` works. The field lookup in these commands (`findFieldByPath` in `satsuma-cli/src/commands/arrows.ts` and siblings) does not expand spreads inside nested records.

The spread must sit on its own line: the grammar reads every word after `...` on that line as the fragment name, so `{ ...audit  oid STRING }` spreads a fragment called "audit oid STRING".

## Acceptance Criteria

- arrows, field-lineage, nl and meta find spread-provided fields at any nesting depth, sharing one spread-aware lookup (core if the LSP needs the same).

## Notes

**2026-10-06T18:02:55Z**

Cause: each field-scoped command built its own field tree. `arrows` and `field-lineage` expanded only schema-level spreads, `meta` matched only top-level spread names and fell back to any field sharing the last segment, and `nl` ignored spreads altogether. Core's `expandDeclaredFields` also skipped spreads inside records that a fragment supplies (`fragment shipping { addr record { ...geo } }`).
Fix: core now expands those copied records too, with a guard against self-spreading fragments. The four commands share `findDeclaredFields` and `findFieldDeclaration` (new `satsuma-cli/src/field-lookup.ts`), which resolve against that tree and read notes and metadata from the fragment that writes the field. `fields` uses `expandDeclaredFields` as well; the remaining top-level-only callers are filed as bsw-s9pd. (commit immediately after fc51a785)
