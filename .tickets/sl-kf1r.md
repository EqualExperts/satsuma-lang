---
id: sl-kf1r
status: in_progress
deps: []
links: [sl-xf3f]
created: 2026-06-11T06:32:46Z
type: bug
priority: 0
assignee: Thorben Louw
tags: [bug-hunt, lsp]
---
# lsp: rename clobbers source_ref metadata and fragment spread sigils — whole-node reference ranges

Two more reference-index entry kinds in satsuma-viz-backend/src/workspace-index.ts store ranges wider than the name they are keyed under, and rename.ts replaces the stored range verbatim (same destructive-edit class as sl-xf3f). (1) Source/target refs (indexMappingRefs ~656/668) store nodeRange(source_ref), and source_ref = name + optional metadata_block — renaming schema customers -> clients turns 'source { customers (note "refreshed daily") }' into 'source { clients }', silently deleting the metadata/note. (2) Fragment spreads (indexArrowSpreadRefs ~701 and indexSpreadRefs ~969) store nodeRange(fragment_spread), which includes the '...' sigil — renaming fragment audit_fields -> tracking_fields turns '...audit_fields' into 'tracking_fields', deleting the sigil and leaving an invalid declaration. Both proven via prepare-approved computeRename round trips against current main (197ac2e). Import-name and metric_source entries already store exact ranges. Same wide ranges also make Find All References highlight metadata blocks and spread sigils.

## Acceptance Criteria

source_ref reference ranges cover only the name node (qualified_name/backtick_name/identifier), never the metadata block; fragment_spread reference ranges cover only the spread_label; rename round-trip tests prove metadata blocks and ... sigils survive; both spread indexing sites (mapping bodies and schema/fragment bodies) covered.

