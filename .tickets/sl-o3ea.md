---
id: sl-o3ea
status: open
deps: []
links: []
created: 2026-06-10T23:21:30Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, core, nl-ref]
---
# core: computeNLRefPosition off by string-delimiter width on first-line refs

satsuma-core/src/nl-ref.ts:167 — NL text passed in has the opening delimiter stripped (1 char for ", 3 for """), but the no-newline branch computes column = item.column + offset + 1 without accounting for it. Refs after a newline in multiline strings are correct; first-line refs are off by one (or three for multiline strings). Surfaces in CLI lint output: line 7 col 26 ref reported as 7:25 (points at the space before the @). The function is documented as the single source of truth for NL ref diagnostic positions.

## Acceptance Criteria

Reported column points exactly at the @ for single-line strings, first line of multiline strings, and post-newline refs; regression tests for all three.

