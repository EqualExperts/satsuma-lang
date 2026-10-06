---
id: bsw-2yzd
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, core, adr-053, paths]
---
# core: ^. pops the wrong segment when the container is a backtick name containing a dot

`tooling/satsuma-core/src/reference-stages.ts:258` splits the container path on `.`, but `pathText` has already stripped the backticks, so `` `line.items` `` splits into two segments.

```satsuma
schema src { sid STRING  `line.items` list_of record { v STRING } }
schema tgt { rows list_of record { x STRING  y STRING } }
mapping m {
  source { src }
  target { tgt }
  each `line.items` -> rows {
    .v -> .x
    ^.sid -> .y
  }
}
```

`validate`: "Arrow source 'line.sid' not declared in schema 'src'". Expected `^.sid` to resolve to `sid`. Likely fixed together with the backtick-segment ticket by carrying segments rather than joined text.

## Acceptance Criteria

- Container paths are handled as segment lists; the repro validates clean and coverage marks `sid` covered.

## Notes

**2026-10-06T17:03:51Z**

Cause: Containers travelled as joined text with backticks already stripped, and `resolveAuthoredPathAgainstContainer` split that text on `.`, so `` `line.items` `` counted as two levels and `^.` popped only `items`; `findAncestorEscape` miscounted the same way.
Fix: Containers now carry their CST segments: new core `resolvePathSegmentsAgainstContainer` and `ContainerSegments` (reference-stages.ts), `resolveArrowPath`/`ResolvedArrowPath` in arrow-path.ts used by extraction and NL-ref, `ArrowNesting.source/targetContainerSegments` for the validate hint; the string resolver also accepts segments. Follow-up for the ambiguous joined identity: bsw-h3qg. (commit immediately after 2b1e9f65)
