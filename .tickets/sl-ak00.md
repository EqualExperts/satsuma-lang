---
id: sl-ak00
status: closed
deps: []
links: []
created: 2026-06-11T02:41:53Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz-backend: lineage merge lets primary-file stub schema beat upstream full definition

satsuma-viz-backend/src/viz-model.ts:1470-1535 (dedup) with injectImportedSchemaStubs (152-223). Doc comment claims stubs are "naturally superseded when the upstream full definition is present", but the merge sorts the primary model first and dedup is first-wins — and the primary model contains the stub. In lineage mode the imported schema renders with label null, empty metadata, empty notes, and empty field constraints INCLUDING pii. Proven: email pii constraint, schema note/owner metadata, and label all vanish from the merged model.

## Acceptance Criteria

Full definitions win over stubs regardless of merge order; pii/metadata/labels survive lineage merge; regression test.


## Notes

**2026-06-11T11:25:00Z**

Cause: the merge sorts the primary model first with first-wins dedup, but the primary model holds only the stub injected by injectImportedSchemaStubs — so the stub (null label, empty metadata/notes/constraints incl. pii) beat the upstream full definition, contradicting the doc comment's "naturally superseded" claim.
Fix: stubs are now explicitly marked (`SchemaCard.isStub`) and mergeVizModels upgrades a kept stub in place when a full definition arrives from a later model; primary-wins is unchanged for genuine duplicate definitions. Regression tests cover label/owner metadata, pii constraints, and the duplicate-definition tie.
