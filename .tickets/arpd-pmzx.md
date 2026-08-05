---
id: arpd-pmzx
status: closed
deps: [arpd-zp4u]
links: []
created: 2026-08-05T09:56:50Z
type: task
priority: 2
assignee: Thorben Louw
parent: arpd-6iis
---
# Update Feature 44 PRD to consume Feature 45's measured baselines

Feature 44's PRD currently owns the static token-counting baseline measurement as its own Phase 2 step. Update it to reference the numbers measured in this feature instead, per Feature 45 PRD's acceptance criterion.

## Acceptance Criteria

features/44-token-and-task-eval/PRD.md's Phase 2 section points at Feature 45's measured results rather than describing the measurement as work it still owns.


## Notes

**2026-08-05T10:51:15Z**

## Notes

**2026-08-05T13:00:00Z**

Cause: Feature 44's PRD carried its own bytes/4 estimates and section tables (Section sizes, mechanism-cost, task-need) for the pre-restructure monolithic document, duplicating what Feature 45's PRD now owns and measures.
Fix: replaced Feature 44's estimate tables and "Satsuma pays for its own reference material" framing with the measured figures from reference/token-costs.md (linked, not re-derived), corrected "must ship and be released" to reflect current status (implemented on this branch, not yet merged/released), and updated the "static baseline... owned by Feature 45" line from future to done tense (commit immediately after c3c824bf).
