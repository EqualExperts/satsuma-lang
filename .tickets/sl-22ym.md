---
id: sl-22ym
status: closed
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


## Notes

**2026-06-11T07:23:03Z**

Cause: resolveAndStripSpreads built the fragment lookup keyed by namespace-qualified ids (crm::audit) but invoked core expandEntityFields with currentNs=null, so a bare ...audit spread inside a namespace never resolved; the spread list was then unconditionally cleared, erasing both the fields and any trace of the spread.
Fix: pass the namespace group's name as the resolution context so bare same-namespace spreads expand, and only remove spreads that actually resolved — unresolvable ones stay on the SchemaCard, which the frontend already renders as a '… spreads X' indicator. Regression tests for both behaviours.
