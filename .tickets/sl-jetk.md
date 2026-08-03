---
id: sl-jetk
status: open
deps: []
links: []
created: 2026-08-03T12:30:45Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [viz, ui]
---
# viz mapping detail: a mapping with no field arrows renders a bare table header and empty body

Report and model consumer mappings legitimately declare no field arrows -- they declare source {schemas} and target {schema} only. In the mapping detail view these render an arrow table consisting of a header row (Source / Transform / Target) with nothing beneath it, which reads as a broken or half-loaded panel rather than a deliberate 'this consumer has no field-level arrows' state.

Observed on examples/reports-and-models/pipeline.stm for both _weekly_sales_dashboard_report and _churn_predictor_pipeline (0 arrow rows each). That file's stated purpose is to demonstrate reports and models as first-class pipeline consumers, so this empty-header rendering IS the primary presentation of the documented pattern.

Root cause: satsuma-viz/src/components/sz-mapping-detail.ts _renderArrowTable (line 670) always emits <thead> with the four column headers, and <tbody> receives nothing when arrows, eachBlocks, flattenBlocks and nestedArrows are all empty. There is no empty-state branch.

## Acceptance Criteria

- A mapping whose arrows, eachBlocks, flattenBlocks and nestedArrows are all empty renders a defined empty state instead of a bare header, explaining that the mapping declares no field-level arrows.
- The column headers are not shown when there are no rows to head.
- A test covers the empty case using a minimal report/model mapping snippet (not the whole example file).
- The non-empty case is unchanged.

