---
id: sl-sewl
status: open
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

