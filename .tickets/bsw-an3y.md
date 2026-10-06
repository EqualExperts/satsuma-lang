---
id: bsw-an3y
status: closed
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

## Notes

**2026-10-06T10:33:06Z**

Cause: The text view walked the CST separately from `--json`/`--arrows-only`, and its `printBlockNode` recursed only into map, computed and nested arrows, so an each/flatten inside an each/flatten vanished.
Fix: All three output modes now render one arrow tree built by a single recursive walk, so the text view prints nested list blocks at any depth. Tests in `tooling/satsuma-cli/test/mapping.test.ts`, including `examples/nested-iteration/`. (commit immediately after 914c97c2)
