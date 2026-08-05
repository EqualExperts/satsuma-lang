---
id: sl-4czz
status: in_progress
deps: [sl-jcs6]
links: []
created: 2026-07-31T13:13:41Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-3de8
tags: [feature-36, viz]
---
# viz: chain view rendering (left-to-right field lineage rail)

PRD 36 R4. Render a selected field's chain model as a single left-to-right rail: upstream sources, visually anchored focus field, downstream consumers; one card per hop (schema + field) with edges labelled by mapping name and classification badge; nl-derived hops visibly differentiated.

## Design

Entry points: field action in expanded cards and detail view (trace this field) plus programmatic component API for hosts, accepting a host-supplied chain model. The component API is host-agnostic and the harness drives the same API, but wiring it to playground URL state is out of scope — public-playground exposure is deferred to its own feature (see sl-1ml2). The PRD's earlier mention of playground URL state as an entry point was corrected in doc review 2026-07-31. Branching renders as a fan, collapsed by namespace with expand-on-click (user decision). Depth limit shows an explicit affordance, never silent truncation. Hop click refocuses the chain on that field; mapping label click opens that mapping detail. Back navigation preserves the Feature 34 R1 guarantee: an edit while in chain view re-traces the same field if it still exists, falls back to overview only when it does not.

## Acceptance Criteria

Three-mapping chain fixture renders all hops in order with correct labels and classifications; nl-derived hop distinct; namespace fan collapse and expand works; depth-limit affordance shown; hop refocus and mapping-label navigation work; edit-while-in-chain-view preserves state; unit tests pass locally.

