---
id: sl-ebs9
status: closed
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


## Notes

**2026-06-11T07:03:12Z**

Cause: collectTopLevelComments iterated only root.children and findPrecedingBlock resolved block names against the global namespace group (the namespaceMap parameter was accepted and ignored), so standalone //! and //? comments between blocks inside a namespace never attached to anything and were dropped from the model.
Fix: extracted the sibling-walk into collectSiblingComments(uri, siblings, group) and now run it once for the file root against the global group and once per namespace_block against that namespace's group; findPrecedingBlock takes the scope group. Tests cover the global control case and a namespaced //!+//? pair attaching to the preceding schema.
