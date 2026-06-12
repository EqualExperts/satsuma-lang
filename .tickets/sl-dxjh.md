---
id: sl-dxjh
status: open
deps: []
links: []
created: 2026-06-12T09:31:12Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [cli]
---
# diff: reports pure formatting changes in transform/map bodies as structural changes

satsuma diff between a file and its satsuma-fmt output is not empty: transform bodies and map blocks are reported as '~' changed when the only difference is the line layout fmt introduced (pipe steps split one-per-line, map entries newline-separated instead of comma-separated). fmt guarantees it does not change meaning and diff claims to be structural, so the two disagree about what structural identity means for pipe/map bodies.

Repro: take any file with 'transform t { trim | uppercase | map { "A": x, _: y } }', run satsuma fmt on a copy, then satsuma diff original formatted — the transform body and any mapping arrows containing map blocks are reported changed.

Note: NL strings are delivered verbatim by design, so verbatim comparison of quoted strings is correct. The issue is whitespace/separator-only differences between structurally identical pipe chains and map entry lists.

## Acceptance Criteria

satsuma diff old new reports no changes when new is exactly satsuma-fmt(old); pipe chains and map entries compare on parsed structure, not raw body text; quoted NL strings still compare verbatim; tests cover fmt-roundtrip diff emptiness for the example corpus

