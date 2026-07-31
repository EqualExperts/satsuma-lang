---
id: sl-5nsv
status: open
deps: [sl-0pun, sl-hcan, sl-vu22]
links: []
created: 2026-07-31T14:44:00Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, testing, viz, cli]
---
# test: cross-consumer coverage parity, including fragment-spread expansion

PRD 38 R6. Feature 36 requires the viz overlay's numbers to equal satsuma coverage --json. That guarantee currently has no test that would fail if it broke. Add one: a single nested fixture computed through the CLI path and the viz-backend path, asserting identical leaf verdicts, identical container states and identical percentages.

This is also the test that catches spread-expansion divergence. The three consumers expand fragment spreads at three different points: the CLI before filtering (expandNestedSpreads/expandEntityFields in fields.ts:74-82), viz at model-build time (viz-model.ts:266-298), and the LSP/core coverage path NOT AT ALL — so fields a schema acquires via ...fragment are currently invisible to the gutter and status bar while the CLI lists them, appearing in neither numerator nor denominator.

## Acceptance Criteria

Parity test over one nested fixture asserts identical leaf verdicts, container states and percentages across the CLI and viz-backend paths. Spread-materialised nested fields are counted in every consumer, using tooling/satsuma-cli/test/fixtures/nested-record-spread.stm where a record body contains only '...address_fields' — address.street and address.city appear as coverage entries with correct states in all paths. A new fixture covers a spread into a list_of record body, which exists nowhere in the repo today. A test covers one fragment spread into two sibling record bodies (examples/lib/sfdc_fragments.stm shape) asserting that mapping BillingAddress.Street leaves ShippingAddress.Street uncovered.

