---
id: sl-6x1o
status: open
deps: []
links: []
created: 2026-06-10T22:04:35Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, vscode, viz-model]
---
# Viz detail view drops mapping-level metadata and non-constraint field meta

(Issue b) In the detailed Mapping Visualisation, mapping-level meta — especially 'note' and 'descr', but also bare tags like 'airflow' — never appears in the central mapping block header; only sources, target, join and filters render. Likewise schema field meta only shows the whitelisted constraint badges (pk, required, pii, indexed, unique, encrypt); key-value meta like 'sensitivity internal' or 'access_group property_facilities' is silently dropped, and even whitelisted kv entries lose their value.

Root causes:
- tooling/satsuma-viz-model/src/index.ts:79 — MappingBlock has no metadata field; tooling/satsuma-viz-backend/src/viz-model.ts:760 extractMapping never reads the mapping's metadata_block, so '(airflow, note "...")' is dropped at extraction.
- tooling/satsuma-viz-model/src/index.ts:63-74 — FieldEntry carries only constraints: string[]; extractConstraintsFromMeta (viz-backend/src/viz-model.ts:649) whitelists CONSTRAINT_TAGS and pushes only entry.key for kv entries, discarding values.
- tooling/satsuma-viz/src/components/sz-mapping-detail.ts:567-611 _renderMappingHeader renders only sourceRefs/targetRef/join/filters.
- tooling/satsuma-viz/src/components/sz-schema-card.ts:642-685 _renderField renders constraints as badges only. Schema-LEVEL metadata pills already exist as the rendering pattern (sz-schema-card.ts:581-601, feature 34 vertical meta pills).

Fix direction: add metadata: MetadataEntry[] to MappingBlock and FieldEntry in viz-model; extract full metadata in viz-backend (mapping metadata_block + field meta entries); render all mapping meta as rows in the detail header (note/descr wrapped like join/filter) and all field meta as key+value pills alongside the existing constraint badges. Keep PII shield badge behavior.

## Acceptance Criteria

mapping export_to_csv (airflow, note "...") shows 'airflow' and the note in the central mapping header. Field 'CLOSING_DATE DATE (sensitivity internal, access_group property_facilities)' shows both kv pills with values in the schema card. Existing constraint badges unchanged. Unit tests in viz-backend cover mapping/field metadata extraction; Playwright harness covers rendering.

