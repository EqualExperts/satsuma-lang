---
id: sl-dz3n
status: closed
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


## Notes

**2026-06-11T06:46:10Z**

Cause: five formatter collector loops dispatched only on content node types — arrow/pipe-chain bodies, source/target blocks, metadata blocks, note blocks, and block opening-brace rows all silently dropped comment children, contradicting the module header promise of comment preservation.
Fix: interleave comments in all five collectors (same-line comments append to their entry, own-line comments keep their line, brace-row comments stay on the header via new braceLineCommentSuffix helper) and force multi-line layout when comments are present; six regression tests proven failing pre-fix (commit ddffbe4)
