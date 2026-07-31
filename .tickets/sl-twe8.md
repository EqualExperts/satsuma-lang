---
id: sl-twe8
status: open
deps: [sl-5m9x]
links: []
created: 2026-07-31T13:13:41Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-3de8
tags: [feature-36, viz]
---
# viz: uncovered-field treatment in expanded cards and mapping detail view

PRD 36 R2. In coverage mode, uncovered fields render with a distinct theme-safe treatment (muted plus iconography, not colour alone) in expanded schema cards and the mapping detail view.

## Design

Presentation only — reuse the existing field-coverage.ts covered-set computation; no new semantics.

## Acceptance Criteria

Uncovered fields visually distinct in both views in light and dark themes; covered-set values unchanged from existing field-coverage.ts behaviour (no semantic drift); unit tests pass locally.

