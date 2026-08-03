---
id: cbdr-o6xn
status: open
deps: []
links: []
created: 2026-08-03T15:34:41Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r3, core, property-testing]
---
# core: add semantic generators and generated coverage properties

Implement Feature 39 R3's generated-input coverage hardening. Add a reusable test-only semantic scenario model and renderer, then use it to check coverage and path invariants over generated valid Satsuma rather than only hand-selected examples.

## Design

Add fast-check as a dev dependency of satsuma-core. Keep the scenario model, arbitraries, renderer, and failure-reporting helpers under core test support: they are test infrastructure, not a second production API. Generate declarations, nested fields, refs, arrows, and fragment spreads as semantic data before rendering source. Every scenario used for a semantic assertion must first parse without ERROR or MISSING recovery nodes. Configure property execution and assertion messages so failures expose fast-check's seed/path plus the shrunk rendered Satsuma. Keep domains bounded and readable so counterexamples remain small. Do not reuse production coverage helpers to manufacture expected values; R4 owns the independent oracle.

## Acceptance Criteria

fast-check is added only to satsuma-core devDependencies and npm audit reports no high or critical vulnerability introduced; a documented test-support module generates bounded semantic scenarios with declarations, nested leaves, authored refs, mappings/arrows, and spread/explicit redeclaration cases and renders valid Satsuma; generated semantic tests fail immediately with the seed, replay path, and shrunk source if rendering produces ERROR or MISSING nodes; purpose-commented properties prove all eight R3 invariants: exact 0%/100% endpoints for non-empty schemas, one coverage entry per qualified declared path after spread expansion, record-to-record whole-structure target expansion, no target subtree expansion from scalar or unresolved sources, exact proper-prefix ancestor derivation, the three schemaLocalFieldPath normalization cases, coverage-ratio preservation under structure-preserving re-nesting, and monotonic leaf coverage when a valid arrow is added; each property names its ADR or contract and uses minimal bounded inputs without filtering away invalid renders; existing hand-authored coverage/path regressions remain and the full satsuma-core suite passes.
