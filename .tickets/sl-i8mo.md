---
id: sl-i8mo
status: closed
deps: []
links: []
created: 2026-06-11T02:41:53Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz: edge metadata wiped for every namespace except the last; module-level layout state races

satsuma-viz/src/layout/elk-layout.ts:577-583 — edgeMetaMap is module-level and addMappingEdges clears it at the top, but buildElkGraph calls it once PER NAMESPACE (line 421). Any later namespace group (even one with zero mappings) erases the metadata of earlier namespaces edges; extractLayout then emits those edges with empty sourceNode/targetNode/sourceField/targetField and a dummy arrow — breaking edge styling, gear icons, click-to-navigate, and field-hover highlighting. Proven: model with one global mapping plus one named namespace containing only a schema -> 1/1 edges lose metadata; single-namespace control fine. Related hazard: the same module-level edgeMetaMap/allPortIds (line 580) are shared across concurrent computeLayout calls (_runLayout uses Promise.all) — a second build can clear/repopulate between another call graph-build and its post-await extractLayout read.

## Acceptance Criteria

Edge metadata survives multi-namespace models; layout state is per-invocation (no module-level mutable maps); multi-namespace and concurrent-layout tests.


## Notes

**2026-06-11T20:40:33Z**

Cause: elk-layout.ts kept edgeMetaMap and allPortIds as module-level mutable state; addMappingEdges cleared edgeMetaMap at the top and was called once per namespace, so any later namespace group erased earlier namespaces' edge metadata, and concurrent computeLayout calls raced on the shared maps between graph build and post-await extraction.
Fix: all bookkeeping (edge metadata, port registry, per-node port maps, card views) moved into a per-invocation GraphContext created by buildElkGraph and threaded into extractLayout; module-level state deleted. Regression tests cover a trailing empty namespace and two concurrent layouts with colliding edge ids (commit 181b3ac)
