---
id: sl-ak00
status: open
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

