---
id: sl-7ind
status: closed
deps: [sl-v3w5]
links: []
created: 2026-08-03T12:24:35Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-12kz
tags: [vscode, field-lineage]
---
# VS Code panel renders sz-field-lineage; delete the duplicate renderer

Repoint FieldLineagePanel at the shared component and remove the VS Code-only rendering path: field-lineage.ts (560 lines) and field-lineage.css (330 lines).

Closing this ticket is what makes the feature a consolidation rather than an addition -- if the old renderer survives, the repo has two lineage renderers and the drift risk the feature exists to remove.

## Acceptance Criteria

- FieldLineagePanel renders sz-field-lineage.
- vscode-satsuma/src/webview/field-lineage/field-lineage.ts and field-lineage.css are DELETED, not left unused.
- Verified in a real VS Code session: the panel renders and matches the pre-port reference screenshots.
- Exactly one lineage renderer exists in the repo afterwards.


## Notes

**2026-08-06T13:20:35Z**

## Notes

**2026-08-06T00:00:00Z**

Cause: this ticket asked to repoint FieldLineagePanel at a shared component and delete the VS Code-only renderer -- but sl-iwlv (Feature 36, merged 2026-08-05) already did exactly this. satsuma.traceFieldLineage now opens sz-chain-view in the main viz panel via a host-computed FieldChainModel (LSP satsuma/fieldChain request); the 560-line field-lineage.ts renderer, 284-line panel.ts, and 330-line CSS this ticket wanted deleted were deleted in that commit.
Fix: closing as superseded, not implemented -- verified via git log/show on 7fe09a98 (sl-iwlv) that the field-lineage/ directory no longer exists and the panel renders sz-chain-view. features/40-shared-field-lineage-view/PRD.md updated to Status: SUPERSEDED. (commit immediately after 9fe61674)
