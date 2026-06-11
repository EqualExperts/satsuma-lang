---
id: sl-ei1e
status: closed
deps: []
links: []
created: 2026-06-11T02:41:29Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: semantic diagnostics union mapping sources/targets per file — duplicated and misattributed undefined-ref

satsuma-lsp/src/semantic-diagnostics.ts:293-301 defEntryToMapping gathers sources/targets from ALL references in the same file (ref.uri === entry.uri is the only filter), so every mapping inherits every other mapping refs. Repro: file with mappings good and bad where only bad references does_not_exist emits TWO undefined-ref diagnostics — one falsely attributed to good. Any multi-mapping file duplicates and misattributes these diagnostics.

## Acceptance Criteria

Sources/targets attributed per mapping (range-scoped), not per file; multi-mapping file emits exactly one diagnostic at the offending mapping.


## Notes

**2026-06-11T13:07:36Z**

Cause: defEntryToMapping/defEntryToMetric gathered source/target/metric_source refs from every reference in the same file (uri-only filter), so each mapping/metric inherited every other block's refs — undefined-ref diagnostics duplicated once per block and misattributed.
Fix: refs are matched by the container identity recorded at index time (metric_source refs now also carry container, mirroring mappings); a multi-mapping file emits exactly one diagnostic at the offending block. Regression tests for both mapping and metric attribution.
