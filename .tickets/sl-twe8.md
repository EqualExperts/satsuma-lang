---
id: sl-twe8
status: closed
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


## Notes

**2026-08-05T14:04:41Z**

Cause: PRD 36 R2's uncovered-field treatment was already delivered as a side effect of sl-f0x6 (the port-dot tri-state fix) — sz-schema-card's _renderField is shared verbatim by expanded overview cards, standalone cards, and the mapping detail view's source/target columns, so the shape-based mapped/partial/unmapped/unknown dot (muted colour, not colour alone) already renders in every context this ticket names. The only real gap was proof: the harness only ever mounted that markup via the mapping detail view (one mapping's own coverage verdicts); nothing had exercised it via the overview's expanded compact card, which feeds the aggregate coverage unioned across every mapping referencing the schema (buildCoverageIndex) — a distinct data path never rendered in a real browser.
Fix: no component code changed. Added two theme-parameterised Playwright specs (light/dark) to the "Field coverage indicators" describe block in tooling/satsuma-viz-harness/test/harness.test.ts, using the filter-flatten-governance fixture's order_events schema (read by two mappings, so its aggregate genuinely differs from either mapping's own view) to prove covered/partial/uncovered port dots render distinctly in the overview's expanded card, mirroring sl-f0x6's mapping-detail proof. Ground truth for which leaves are uncovered in the aggregate was confirmed via `satsuma coverage --json` against the fixture before writing the assertions. Full harness suite (107 tests) green. (commit immediately after de30d6ba)
