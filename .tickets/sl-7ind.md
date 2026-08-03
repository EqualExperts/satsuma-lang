---
id: sl-7ind
status: open
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

