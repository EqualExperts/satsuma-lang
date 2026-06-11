---
id: sl-l7u0
status: open
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

