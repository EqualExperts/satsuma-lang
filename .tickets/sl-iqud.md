---
id: sl-iqud
status: open
deps: []
links: []
created: 2026-06-11T02:41:53Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz: field coverage broken for schema-prefixed arrow paths in namespaced mappings

satsuma-viz/src/field-coverage.ts:34-49 — resolveSchemaLocalFieldPath only strips a schema.qualifiedId prefix, but arrows keep authored text (customers.id) while the backend resolves sourceRefs to qualified ids (crm::customers). The bare-id prefix never matches and schemaHasFieldPath fails, so every prefixed source field in a namespaced (e.g. multi-source join) mapping is reported unmapped — wrong port dots, wrong mapped/total counts, no hover cross-highlighting. Proven: namespaced model sourceMapped empty for both schemas; un-namespaced control covered correctly.

## Acceptance Criteria

Prefixed paths match against both authored and qualified schema ids; namespaced multi-source coverage test.

