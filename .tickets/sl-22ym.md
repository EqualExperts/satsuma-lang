---
id: sl-22ym
status: open
deps: []
links: []
created: 2026-06-11T02:41:53Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, viz]
---
# viz-backend: fragment spreads inside a namespace silently dropped (fields lost)

satsuma-viz-backend/src/viz-model.ts:261-289 — resolveAndStripSpreads keys fragments by qualified id (crm::audit, set by extractFragment:564) but calls expandEntityFields with currentNs = null, so a bare ...audit spread can never resolve (see core spread-expand.ts:246 makeEntityRefResolver). The spread is then erased (s.spreads = [], fragments stripped), so the card shows neither the fields nor any hint a spread existed. Proven: namespaced schema shows only [id]; identical global-scope control shows [id, created_at].

## Acceptance Criteria

Namespaced spreads expand correctly; unresolvable spreads are preserved/flagged rather than erased; namespaced spread test.

