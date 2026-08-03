---
id: cbdr-da0j
status: open
deps: [cbdr-o6xn]
links: []
created: 2026-08-03T16:03:45Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r4, core, property-testing]
---
# core: differentially test coverage against an independent oracle

Implement Feature 39 R4. Build a deliberately small, test-only coverage oracle over R3's semantic scenarios, render each scenario through the real parser/extraction/coverage pipeline, and compare qualified field states and rollups without reusing production coverage helpers to calculate expected results.

## Design

Add the oracle in satsuma-core test support, separate from generated-scenarios.js's production-path adapter. Materialise declarations and spread-expanded qualified paths directly from semantic data; apply direct-arrow, whole-record, scalar/unresolved fail-closed, and spread-shadowing rules as plain set operations; derive container state and leaf rollups independently. Document the rule-to-ADR mapping beside the oracle. Extend the bounded semantic arbitrary only as needed to exercise combinations rather than creating grammar strings directly. Keep production types/helpers out of expected-value calculation and keep the oracle test-only.

## Acceptance Criteria

A purpose-commented fast-check differential suite compares every qualified source and target field's mapped/state verdict plus covered/total/pct rollups between the semantic oracle and coverageForScenario after recovery-free parse, extraction, spread expansion, and production coverage computation; the oracle does not import or call production coverage helpers and has a concise rule-to-ADR table; failures retain fast-check seed/path and shrunk rendered Satsuma; a local mutation restoring bare-segment registration fails with a repeated-name counterexample; a local mutation restoring spread/explicit duplication fails the oracle or uniqueness property; a local mutation removing ADR-038's container-source condition fails with a shrunk scalar-to-record counterexample; existing R3 properties and hand-authored regressions remain; npm --prefix tooling/satsuma-core test and npm audit pass; the ticket receives a timestamped cause/fix note before closure.
