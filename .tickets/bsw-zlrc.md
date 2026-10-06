---
id: bsw-zlrc
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, core, nl-ref, adr-053]
---
# core: NL-derived arrow inside a flatten with an escaped target gets an undeclared target

`containerTargetBase` (`tooling/satsuma-core/src/nl-ref.ts:987`) treats any flatten target that is not a `relative_field_path` as the schema-name form and falls back to the outer target, so `parent_path` / `root_path` targets (valid in headers per ADR-053) are ignored. Extraction (`extract.ts` `collectArrowRecords`) resolves the declared arrows correctly, so the two disagree.

```satsuma
schema src { sid STRING  orders list_of record { oid STRING  lines list_of record { sku STRING } } }
schema tgt { rows list_of record { r STRING }  flat list_of record { s STRING  t STRING } }
mapping m {
  source { src }
  target { tgt }
  each orders -> rows {
    .oid -> .r
    flatten .lines -> $.flat {
      .sku -> .s
      -> .t { "derived from @src.sid" }
    }
  }
}
```

`satsuma arrows src.sid` prints `::src.sid -> rows.t [nl-derived]`; `field-lineage`, `graph --json` and the viz chain view also use the undeclared `tgt.rows.t`. Expected `flat.t`. Same with `^.flat`.

## Acceptance Criteria

- NL-derived arrows inside a flatten/each whose header target is `^.`/`$.`-escaped resolve to the same container as the declared arrows in that block.
- Core test covering `$.` and `^.` header targets, red before the fix.

## Notes

**2026-10-06T17:27:24Z**

Cause: The NL-ref walk in nl-ref.ts (`containerTargetBase`) guessed from the CST node type whether a flatten header named the target schema, and took any header that was not `.field` for the schema form. `$.flat`, `^.flat` and bare list-field headers therefore fell back to the outer base, so NL arrows landed on undeclared fields (`rows.t`, `t`) while extraction put the declared arrows on `flat.*`.
Fix: The special case and `isRelativeTargetPath` are gone, and each/flatten header targets are now resolved with `qualifyTarget`, exactly as extraction does. The schema form now records `tgt.contact_line`, like a declared arrow, and resolveFieldEndpoint strips the prefix downstream. New core tests cover `$.`, `^.`, bare and top-level list-field headers, plus a parity test against extractArrowRecords. The `::tgt.tgt` header edge for the schema form is the separate ticket r0-7w76. (commit immediately after 52d8582d)
