# Feature 30 Viz Harness Audit

Ticket: `sl-0ssj`

This audit records the current browser coverage and selector gaps before the
Feature 30 implementation tickets replace synthetic event checks with real
interaction and rendering assertions.

## Current Harness Coverage

Source: `tooling/satsuma-viz-harness/test/harness.test.ts`

| Test | Fixture | Current classification | What it proves | Gap |
| --- | --- | --- | --- | --- |
| `renders expected schema cards in the overview` | `examples/sfdc-to-snowflake/pipeline.stm` | Real UI rendering | Single-file overview renders four schema-card hosts. | Counts only; does not assert specific schema names, card metadata, field rows, or mapping placement. |
| `renders at least one mapping node in the overview` | `examples/sfdc-to-snowflake/pipeline.stm` | Real UI rendering | Single-file overview renders one mapping node. | Counts only; does not assert `opportunity ingestion`, source/target placement, or mapping card text. |
| `clicking a mapping card opens the detail view` | `examples/sfdc-to-snowflake/pipeline.stm` | Real UI interaction plus shallow detail rendering | A real overview mapping click changes the viz into a visible detail view. | Does not assert correct mapping, source schemas, target schema, arrow rows, transforms, notes, or field coverage. |
| `field-hover events from the viz are captured in the harness event log` | `examples/sfdc-to-snowflake/pipeline.stm` | Synthetic event plumbing | Harness can record a programmatically dispatched `field-hover` event. | Does not exercise DOM hover, production event class fields, hover leave, or visible highlight state. |
| `lineage mode merges schemas from all import-reachable files` | `examples/metrics-platform/metrics.stm` | Real UI rendering and lineage smoke coverage | Lineage mode renders at least two overview schema cards from an import-reaching fixture. | Does not assert metric cards, file filter behaviour, source file names, or single-file vs lineage differences by identity. |
| `expand-lineage events from the viz are captured in the harness event log` | `examples/metrics-platform/metrics.stm` | Synthetic event plumbing | Harness can record a programmatically dispatched `expand-lineage` event. | Does not exercise a production expand-lineage control or assert the view-mode reload path through visible UI. |
| `navigate events from the viz are captured in the harness event log` | `examples/sfdc-to-snowflake/pipeline.stm` | Synthetic event plumbing | Harness can record a programmatically dispatched `navigate` event with detail payload. | Does not click a schema header, field row, mapping title, or arrow row; does not validate production `SzNavigateEvent.location` normalization. |
| `sap-po-to-mfcs renders to ready state without layout failure` | `examples/sap-po-to-mfcs/pipeline.stm` | Layout smoke coverage | Larger fixture reaches ready state and avoids fallback. | Does not assert geometry sanity, non-overlap, canvas bounds, or row/card ordering. |

## Selector Gaps

Source files inspected:

- `tooling/satsuma-viz/src/satsuma-viz.ts`
- `tooling/satsuma-viz/src/components/sz-mapping-detail.ts`
- `tooling/satsuma-viz/src/components/sz-schema-card.ts`
- `tooling/satsuma-viz-harness/src/client/app.ts`

Existing useful hooks:

- `satsuma-viz.ts` exposes `viz-root`, `viz-viewport`, toolbar controls, overview schema cards, overview mapping nodes/cards, and detail root test IDs.
- `sz-mapping-detail.ts` exposes the detail layout root, mapping header, arrow table, and target-field-based arrow row IDs.
- `sz-schema-card.ts` exposes card root, header, fields container, field rows, and field-lineage buttons.

Missing hooks for the next implementation tickets:

| Gap | Owner candidate | Why it blocks Feature 30 |
| --- | --- | --- |
| Detail source, mapping, and target columns do not have stable `data-testid` values. | `tooling/satsuma-viz/src/components/sz-mapping-detail.ts` | Geometry tests need to assert source -> mapping -> target ordering without relying on column header text. |
| Detail source and target schema cards do not receive distinct `testIdPrefix` values. | `tooling/satsuma-viz/src/components/sz-mapping-detail.ts` | Tests cannot reliably distinguish the same schema-card field row rendered as source vs target. |
| Nested schema-card field IDs use only `f.name`, not the full dotted `fieldPath`. | `tooling/satsuma-viz/src/components/sz-schema-card.ts` | Nested fields such as `customer.email` can collide with another `email`; hover and coverage tests need path identity. |
| Coverage ports expose mapped/unmapped only through CSS classes on an unlabelled `.port` span. | `tooling/satsuma-viz/src/components/sz-schema-card.ts` | Field coverage tests need a stable selector or `data-coverage-state` attribute tied to the field row. |
| Highlight state is represented by CSS classes only and has no explicit field-row state attribute. | `tooling/satsuma-viz/src/components/sz-schema-card.ts` and `tooling/satsuma-viz/src/components/sz-mapping-detail.ts` | Hover tests can assert classes, but a stable `data-highlighted` contract would be clearer and less style-coupled. |
| Transform text and highlighted `@ref` spans lack stable test IDs. | `tooling/satsuma-viz/src/components/sz-mapping-detail.ts` and `tooling/satsuma-viz/src/markdown.ts` | Detail tests need to assert NL transform text and `@ref` highlighting without brittle class-only queries. |
| `each` and `flatten` scope rows share the same `.scope-section` class and have no stable test IDs. | `tooling/satsuma-viz/src/components/sz-mapping-detail.ts` | Complex mapping tests need to locate a specific `flatten line_items` or `each` section. |
| Arrow note rows and field note rows lack stable test IDs. | `tooling/satsuma-viz/src/components/sz-mapping-detail.ts` and `tooling/satsuma-viz/src/components/sz-schema-card.ts` | Mapping notes and field notes are part of the complex fixture coverage. |
| Schema-card notes toggle and content lack stable test IDs. | `tooling/satsuma-viz/src/components/sz-schema-card.ts` | Report/model and governance fixtures need note assertions that do not depend on text-only traversal. |
| Overview metric cards and fragment cards do not expose package-level test IDs comparable to overview schema cards. | `tooling/satsuma-viz/src/satsuma-viz.ts`, `sz-metric-card.ts`, and `sz-fragment-card.ts` | Metrics overview tests should assert metric cards directly instead of inferring metrics from generic positioned cards. |
| Harness event recorder stores `(e as CustomEvent).detail` directly. | `tooling/satsuma-viz-harness/src/client/app.ts` | Production event classes expose fields on the event object; the recorder needs normalization before real interaction tests can assert stable JSON payloads. |

## Planned Fixture Map

Use canonical examples for the expanded suite. No harness-only fixture is needed
at the start of Feature 30. Add a harness-only fixture only if an implementation
ticket proves a required behaviour cannot be isolated from the canonical corpus.

| Planned coverage | Fixture | Invariant to assert |
| --- | --- | --- |
| Non-namespaced overview rendering | `examples/sfdc-to-snowflake/pipeline.stm` | Expected vanilla schema cards and the `opportunity ingestion` mapping card render in single-file mode. |
| Opportunity detail rendering | `examples/sfdc-to-snowflake/pipeline.stm` | Detail view for `opportunity ingestion` shows source schemas, target schema, expected arrow rows, computed arrows, map transform, NL transform text, and highlighted `@ref` spans. |
| Real navigation and field-lineage events | `examples/sfdc-to-snowflake/pipeline.stm` | Clicking real schema/field/mapping/arrow UI records normalized `navigate` and `field-lineage` payloads. |
| Namespaced overview and card height path | `examples/namespaces/ns-platform.stm` | Qualified namespace cards and mapping nodes render with namespace labels and unclipped namespace-pill/header geometry. |
| Namespaced mapping detail | `examples/namespaces/ns-platform.stm` | A namespaced mapping detail view shows namespace label plus qualified source and target names. |
| Namespace filter | `examples/namespaces/ns-platform.stm` | Selecting one namespace hides unrelated namespace cards and reset restores all namespaces. |
| Metrics and cross-file lineage | `examples/metrics-platform/metrics.stm` | Lineage mode renders metric cards and imported source schemas from `metric_sources.stm`; file filter can narrow and reset by file. |
| Reports and model cards | `examples/reports-and-models/pipeline.stm` | Report/model schema cards show report/model metadata and consumer mapping content. |
| Multi-source join and mapping notes | `examples/filter-flatten-governance/filter-flatten-governance.stm` | Detail view for `completed orders` shows multiple sources, join text, mapping note, nested child fields, and visible governance/PII indicators where applicable. |
| Flatten section and nested coverage | `examples/filter-flatten-governance/filter-flatten-governance.stm` | Detail view for `order line facts` shows the `flatten line_items` section, nested child source fields, target rows, and mapped/unmapped coverage indicators. |
| Larger layout stability and screenshot review | `examples/sap-po-to-mfcs/pipeline.stm` | Overview reaches ready state and passes geometry sanity checks beyond fallback detection. |

## Recommended Implementation Path

1. Replace synthetic event expectations with real interactions after the event
   recorder normalizes production event classes.
2. Add the selector hooks listed above before expanding detail, coverage,
   highlighting, and geometry tests.
3. Keep the current synthetic event cases only as recorder-level compatibility
   tests if the recorder still intentionally supports `CustomEvent.detail`.
4. Use canonical fixtures for all planned coverage unless a later ticket
   documents a concrete isolation problem.
