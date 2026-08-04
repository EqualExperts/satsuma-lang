---
id: sl-jyee
status: closed
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


## Notes

**2026-08-04T00:00:00Z**

The "BLOCKED on Feature 39 R5, which is not yet ticketed" line in the description
was already stale when it was written: R5 shipped as cbdr-e6ft + cbdr-5r4d
(ADR-044) one commit after the c93b1130 the Feature 41 PRD was checked against.

Cause: qualifyField(field, schemas) collapsed three different situations into one
string and ended with an unconditional `${schemas[0]}.${field}`, so a bare token
that names both a field and a declared schema was silently resolved as a field
(the mechanism of r0-7w76); graph-builder.ts:622 then re-derived an owning schema
from the serialized endpoint with split(".")[0], a second independent derivation
of the same fact.

Fix: added CanonicalFieldEndpoint to Feature 39 R5's stage vocabulary with
composition (fieldEndpointOf) and decomposition (fieldEndpointSchema /
fieldEndpointPath) in reference-stages.ts; replaced qualifyField with
resolveFieldEndpoint, whose FieldEndpointResolution reports the schema-root fork
instead of picking; moved the remaining choice to one named CLI site
(satsuma-cli/src/field-endpoints.ts, arrowEndpoint) used by all three emitters,
with the r0-7w76 default labelled and pinned by a test; made --schema-only
aggregation carry the branded endpoints rather than re-split strings. Output is
byte-identical — all 1046 CLI tests, 689 core tests, core type-tests and the
coverage parity sweep pass unchanged; r0-7w76 remains open and undecided
(commit immediately after b6f08ba8).
