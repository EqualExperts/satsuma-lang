---
id: sl-sewl
status: closed
deps: []
links: []
created: 2026-06-11T02:42:20Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz: SzOpenMappingEvent contract dead — overview edges non-interactive on click

satsuma-viz/src/edges/sz-overview-edge-layer.ts:1-21 class doc says click dispatches SzOpenMappingEvent, but the click handler was removed in commit 8690754; nothing dispatches the event, leaving the exported event class and the open-mapping listener in satsuma-viz.ts:874 dead, and overview edges (pointer-events: stroke) non-interactive on click. Decide: restore the click handler or remove the event class, listener, and stale doc.

## Acceptance Criteria

Either edge click opens the mapping again (with test) or the dead event/listener/doc are removed; no stale contract remains.


## Notes

**2026-06-11T21:01:28Z**

Cause: commit 8690754 (overview edge routing rework) dropped the @click binding from the edge path template; the SzOpenMappingEvent class, the open-mapping listener in satsuma-viz.ts, and the class doc all survived, leaving a dead contract and click-inert edges.
Fix: restored the click handler (_onEdgeClick dispatches SzOpenMappingEvent with the edge's mapping) and added cursor:pointer; chose restore over removal because the receiving listener still switches to the mapping detail view. Component tests pin dispatch, composed/bubbles, and the template binding (commit fc52cee)
