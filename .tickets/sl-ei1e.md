---
id: sl-ei1e
status: open
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

