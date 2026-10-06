---
id: bsw-ks5q
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, codelens]
---
# lsp: mapping code lens arrow count ignores arrows inside each/flatten

`countArrows` (`tooling/satsuma-lsp/src/codelens.ts:173`) counts only top-level children. `examples/ancestor-escape/pipeline.stm` shows "2 arrow(s)" where `satsuma summary` says 4; `examples/nested-iteration/pipeline.stm` shows 3 where summary says 8.

## Acceptance Criteria

- The lens count matches `satsuma summary` for both examples (ideally both use one core count).

## Notes

**2026-10-06T10:19:07Z**

Cause: The LSP's private `countArrows` counted only the mapping body's direct children, so an `each` or `flatten` block counted as one arrow however many it held, while `satsuma summary` counts arrows at every depth.
Fix: Core now exports `countMappingArrows`, which `extractMappings` (and so `summary`) and the code lens both use; the LSP's own counter is gone. A codelens test pins 4 and 8 arrows for the two examples. The summary total also adds NL-derived arrows from workspace analysis, which the per-file lens does not (commit immediately after f379b801)
