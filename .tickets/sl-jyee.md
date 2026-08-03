---
id: sl-jyee
status: open
deps: [sl-hi0z]
links: []
created: 2026-08-03T16:24:15Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-8f2p
tags: [feature-41, lineage, graph]
---
# core: brand lineage and graph endpoints with Feature 39's path/ref stages

Lineage endpoints are the same unbranded strings Feature 39 R5 addresses for coverage. qualifyField (canonical-ref.ts:56) cannot distinguish a bare field name from a container header naming a schema root, and its final branch guesses; graph-builder.ts:622 re-derives an owning schema with edge.from.split('.')[0]. BLOCKED on Feature 39 R5, which is not yet ticketed — this ticket must not pre-empt that design by inventing its own brands.

## Design

Apply the branded stages from Feature 39 R5 to graph and lineage endpoints so an authored ref cannot be emitted where a qualified endpoint is required. Give qualifyField a signature that cannot silently conflate a bare field name with a schema root token: the caller handles the ambiguous case rather than receiving a guess. Replace ad-hoc unbranding such as edge.from.split('.')[0] with a named core accessor. This removes the type-level permission to guess; it does NOT decide what a container header onto a schema root should mean, which remains r0-7w76.

## Acceptance Criteria

Passing an authored ref where a qualified endpoint is required fails a compile-only test. qualifyField's ambiguous case is visible in its return type and handled explicitly at every call site. No ad-hoc schema-prefix extraction from an endpoint string remains in graph or lineage code. JSON, VizModel and LSP protocol shapes are unchanged. r0-7w76 remains open and undecided.

