---
id: sl-ellp
status: closed
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


## Notes

**2026-06-11T06:53:17Z**

Cause: indexNlRefs was called only with each mapping's mapping_body node, so @refs in NL prose outside arrow bodies — (note "...") metadata tags, note blocks at any level, metadata value strings — never entered the reference index, and rename/find-references skipped them.
Fix: indexFile now runs indexNlRefs once over the whole file root (covering note tags, note blocks, namespaced content, and metadata values), the per-mapping-body call was removed to avoid double-indexing, and NL prose refs are tagged with a new "nl" reference context instead of mislabelled "arrow". Tests pin note-tag/note-block/namespace/standalone indexing, no-double-indexing, and rename round-trips through note text.
