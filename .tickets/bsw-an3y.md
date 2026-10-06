---
id: bsw-an3y
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, mapping]
---
# cli: satsuma mapping text output drops each/flatten blocks nested inside each/flatten

`printBlockNode` (`tooling/satsuma-cli/src/commands/mapping.ts:270-288`) recurses only into map, computed and nested-arrow bodies. A nested `each`/`flatten` disappears: `each orders -> out { each lines -> rows { ... } }` prints `each orders -> out {` followed by `}`. `satsuma mapping 'dispatch manifest' examples/nested-iteration/pipeline.stm` omits the inner `each lines` and `flatten` blocks. `--json` and `--arrows-only` are correct. sc-1ar0 (closed) fixed top-level blocks only.

## Acceptance Criteria

- Text output prints nested each/flatten blocks at any depth with their arrows; test against `examples/nested-iteration/`.
