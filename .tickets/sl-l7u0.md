---
id: sl-l7u0
status: closed
deps: []
links: []
created: 2026-06-11T02:42:20Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz: detail-layout edges dropped for prefixed/nested field paths; duplicate and corrupted port ids

satsuma-viz/src/layout/elk-layout.ts — buildFieldPorts (519-557) creates port ids from the BARE field name (node:email:src, even for nested children) while addMappingEdges looks ports up by the full authored path (node:customer.email:tgt, node:src.id:src); the missing-port guard (599) then drops the edge. Proven: prefixed-path arrow -> 0 edges; nested-target arrow -> 0 edges. Also: a field name repeated at two nesting levels produces duplicate port ids (later silently overwrites earlier in LayoutNode.ports), and port id parsing at 648-655 splits on ":" so namespaced node ids (crm::customers) yield garbage field keys.

## Acceptance Criteria

Edges render for prefixed and nested dotted paths; port ids unique per field path and parse-safe for namespaced ids; tests for each case.


## Notes

**2026-06-11T20:40:33Z**

Cause: buildFieldPorts keyed ports by bare field name while addMappingEdges looked them up by the authored arrow ref (schema-prefixed or nested dotted path), so those edges were dropped by the missing-port guard; same-named fields at different nesting levels collided on one port id; extractLayout parsed port ids by splitting on ':', garbling namespaced node ids like crm::customers.
Fix: ports are keyed by the field's full dotted path, authored refs resolve via resolveSchemaLocalFieldPath (param widened to a structural FieldPathCard so metric cards qualify), multi-source arrows attach to the source schema that declares the field, and extractLayout recovers field paths from a portInfo registry instead of string parsing (commit 181b3ac)
