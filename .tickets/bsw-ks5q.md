---
id: bsw-ks5q
status: open
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
