---
id: sl-xf3f
status: closed
deps: []
links: [sl-p256]
created: 2026-06-11T02:41:29Z
type: bug
priority: 0
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: rename produces destructive edits — @ sigil deleted, whole arrow paths clobbered

Two reference-index entries store ranges wider than the name they are keyed under, and rename.ts:114 replaces the whole range. (1) satsuma-viz-backend/src/workspace-index.ts:852 indexNlRefs stores the range of match[0] including the leading @ — renaming schema customers -> clients turns "@customers" into "clients", deleting the sigil and breaking the NL ref. (2) workspace-index.ts:731 indexes the bare first segment of every src_path/tgt_path under that segment name but with the range of the WHOLE path node — a schema named address plus an unrelated arrow address.street -> s: renaming the schema rewrote the arrow to "location -> s", silently destroying the .street part. Both reachable through normal prepare-approved VS Code rename. Same whole-path range also makes Find All References report unrelated arrow paths.

## Acceptance Criteria

Reference ranges cover exactly the identifier being renamed (@ preserved, path segments preserved); rename round-trip tests for NL refs and dotted arrow paths; find-references no longer reports field-path false positives.


## Notes

**2026-06-11T06:22:37Z**

Cause: Two reference-index entry kinds in the shared workspace index (satsuma-viz-backend/src/workspace-index.ts) stored ranges wider than the name they were keyed under — NL @refs kept the @ sigil in the range, and arrow first-segment entries used the whole src_path/tgt_path node range — and rename.ts replaces the stored range verbatim.
Fix: Ranges now cover exactly the keyed identifier, derived from CST path-segment nodes: bare entries span only the first segment, full-path entries exclude the leading dot / ns:: prefix, and NL @ref ranges start one character past the @. Round-trip rename tests and exact-range index tests added. (commit a7a7fc6)
