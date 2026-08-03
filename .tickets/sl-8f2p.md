---
id: sl-8f2p
status: open
deps: []
links: []
created: 2026-08-03T16:23:18Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-41, lineage, graph, tooling]
---
# Feature 41: generated-input confidence for lineage and graph

Deliver Feature 41 from features/41-lineage-graph-confidence/PRD.md: point Feature 39's generated-input machinery at the lineage and graph surfaces, where the generated scenario is itself the ground-truth graph and so needs no independent oracle. Covers the reusable generator package, a workspace-shaped scenario model, structural edge invariants, reachability properties, a cross-consumer parity sweep, and branded endpoints.

## Acceptance Criteria

R1-R6 are delivered through linked child tickets with their PRD acceptance tests passing; every child records its cause/fix note and passing relevant automated tests before closure; the PRD ticket map and status are reconciled when the epic closes; no lineage or graph semantics change and r0-7w76 remains undecided by this epic.

