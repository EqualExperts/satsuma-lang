---
id: sl-ebs9
status: open
deps: []
links: []
created: 2026-06-11T02:42:20Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz-backend: standalone warning/question comments inside namespaces dropped from the model

satsuma-viz-backend/src/viz-model.ts:390-446 — collectTopLevelComments walks only root.children and findPrecedingBlock searches only globalNs (the _namespaceMap parameter is accepted and ignored). A standalone //! or //? comment between blocks inside a namespace disappears from the model, so the warnings/questions pane undercounts. Proven: namespaced -> []; global control attaches to preceding schema.

## Acceptance Criteria

Namespaced standalone //! and //? comments attach to the correct block; warnings pane counts match satsuma warnings; test.

