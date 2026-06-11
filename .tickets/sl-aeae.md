---
id: sl-aeae
status: closed
deps: []
links: []
created: 2026-06-11T02:41:53Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz-backend: lineage merge drops same-named mappings from different namespaces

satsuma-viz-backend/src/viz-model.ts:1490-1492 — mappingKey = id@location.uri omits the namespace. Two mappings named load in namespace a and namespace b of the same file collide; the second is dropped from the merged model entirely. Proven: merged model contains a::load but not b::load.

## Acceptance Criteria

Mapping dedup key includes namespace (or qualified id); both same-named mappings survive merge; test.


## Notes

**2026-06-11T11:25:00Z**

Cause: mergeVizModels deduped mappings by `id@location.uri`; MappingBlock.id is unqualified, so same-named mappings in different namespaces of one file collided and the second was dropped.
Fix: dedup key now includes the namespace group name (`ns::id@uri`); regression test merges a file with `load` in two namespaces.
