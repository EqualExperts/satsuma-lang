---
id: sl-ellp
status: open
deps: []
links: []
created: 2026-06-11T02:41:30Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: NL refs in note tags and note blocks never indexed

satsuma-viz-backend/src/workspace-index.ts:832-862 indexNlRefs walks only mapping_body. Proven: (note "joins against @customers") mapping-level metadata produces no reference entry. Rename/find-references update arrow-body NL refs but skip note-text refs entirely, leaving stale prose references after a rename.

## Acceptance Criteria

NL refs in note tags, note blocks, and metadata value strings are indexed; rename updates them; find-references lists them.

