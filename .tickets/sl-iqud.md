---
id: sl-iqud
status: closed
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


## Notes

**2026-06-11T11:40:00Z**

Cause: resolveSchemaLocalFieldPath only stripped the namespace-qualified schema.qualifiedId prefix, but arrows keep authored bare-id text ("customers.id") while the backend qualifies sourceRefs ("crm::customers") — the prefix never matched, so every prefixed source field in a namespaced multi-source mapping was reported unmapped.
Fix: schemaRefPrefixes() matches both the qualified and authored bare form for the owning schema AND for the sibling-schema exclusion check in satsuma-viz field-coverage.ts. Tests cover bare/qualified resolution, sibling exclusion, and a namespaced multi-source coverage repro.
