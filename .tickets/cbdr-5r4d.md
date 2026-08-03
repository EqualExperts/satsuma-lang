---
id: cbdr-5r4d
status: open
deps: [cbdr-e6ft]
links: []
created: 2026-08-03T16:26:52Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r5, core, cli, viz, types]
---
# core: enforce opaque stages at coverage boundaries

Tighten core coverage and path-resolution APIs to accept only values at the correct reference stage, then migrate every TypeScript consumer at the JSON, CST, LSP, or VizModel boundary through the validating constructors and named transitions.

## Design

Migrate schemaLocalFieldPath to ContainerQualifiedFieldRef -> SchemaLocalPath | null. Make covered-path builders and probes consume SchemaLocalPath and expose branded direct/ancestor sets; apply the stage vocabulary inside computeMappingCoverage and declared-field probing. Keep result models, VizModel, LSP payloads, and JSON serialized fields as strings. Update CLI lint and satsuma-viz resolution wrappers by constructing boundary values rather than casting. Consolidate stage-invariant compile tests in core; consumer tests assert only their own behaviour and protocol parity.

## Acceptance Criteria

schemaLocalFieldPath accepts only ContainerQualifiedFieldRef and returns SchemaLocalPath | null; buildCoveredFieldPaths and coverage path probes accept only SchemaLocalPath values; passing a raw string or AuthoredFieldRef to a schema-local coverage API fails a compile-only test while createSchemaLocalPath("city") succeeds; passing AuthoredEntityRef where CanonicalEntityRef is required fails compile-only checking; all core producers and CLI/viz consumers enter the typed domain through public validation or semantic transitions with no casts; JSON, VizModel, and LSP protocol shapes remain strings and existing snapshots/parity tests are unchanged; core, CLI, LSP, viz-backend, viz-model, and viz tests/builds pass.

