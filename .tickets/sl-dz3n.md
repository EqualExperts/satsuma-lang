---
id: sl-dz3n
status: in_progress
deps: []
links: []
created: 2026-06-10T23:21:30Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, core, fmt]
---
# fmt: comments lost in five distinct positions

satsuma-core/src/format.ts loses comments (confirmed by repro: comment present in valid input, absent after formatting) in: (1) arrow transform bodies — formatMapArrow/formatPipeChain (700-724, 887-917) iterate only pipe_step children; (2) source { } blocks — formatSourceBlock (629-662) collects only source_ref/nl_string; (3) metadata blocks — collectMetadataEntries:1168 has explicit "if (isComment(child)) continue"; (4) note { } blocks — formatNoteBlock (994-1022) collects only strings; (5) inline comment on schema/mapping opening-brace line — collectBlockLeadingComments:113-114 skips brace-row comments claiming the caller handles them, but only formatMultiLineField does; formatSchemaBlock/formatMappingBlock do not. Module header promises the formatter preserves comments.

## Acceptance Criteria

Comments in all five positions survive formatting; idempotency preserved; fixtures cover each position.

