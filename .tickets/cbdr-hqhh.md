---
id: cbdr-hqhh
status: closed
deps: []
links: []
created: 2026-08-03T17:07:55Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r8, core, cli, lsp, viz-backend]
---
# core: model FieldDecl as structural variants and migrate consumers

Implement Feature 39 R8 as one atomic public-model migration. Replace the optional FieldDecl property bag with explicit scalar, record, scalar-list, and record-list variants in satsuma-core; update extraction, shared helpers, CLI, LSP, and viz-backend consumers; and preserve the existing runtime and JSON field shape.

## Design

Keep the existing serialized properties as the compatibility boundary: no new enumerable discriminator and no protocol-shape change. Express valid shapes through named exported variants and shared base/location fields; record-bearing variants own children and spread state, list variants make list element shape explicit. Add a core assertNever helper for intentionally exhaustive domain handling. Consolidate union invariant tests in core and leave consumer tests at rendering or protocol boundaries. Coordinate with the separate R7 lint rollout instead of absorbing its package-wide configuration changes.

## Acceptance Criteria

Core exports documented ScalarFieldDecl, RecordFieldDecl, ScalarListFieldDecl, RecordListFieldDecl, and FieldDecl union contracts plus assertNever; scalar fields cannot carry children or spread state and record-list fields require children in compile-only tests; extractFieldTree returns all four variants while preserving existing enumerable runtime and JSON properties; shared spread, validation, NL-ref, and field utilities narrow safely; CLI, LSP, and viz-backend compile and retain their existing output/protocol behavior; core owns the structural invariant tests and consumers do not duplicate them; CHANGELOG Unreleased calls out the stricter TypeScript source contract; relevant package tests, typechecks, lint, and repository checks pass.

## Notes

**2026-08-03T18:17:58Z**

Cause: `FieldDecl` represented four grammar-defined shapes as one optional-property bag, so TypeScript admitted scalar children and spreads, bodyless record lists, and inconsistent consumer inference.
Fix: Introduced JSON-compatible structural variants, a branded scalar type, shared normalization and classification, and exhaustive handling; migrated extraction and all consumers; added compile/runtime coverage, ADR-045, and release documentation. (commit immediately after b97ecec9)
