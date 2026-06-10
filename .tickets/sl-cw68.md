---
id: sl-cw68
status: closed
deps: []
links: []
created: 2026-06-10T07:18:52Z
type: bug
priority: 1
assignee: Thorben Louw
parent: sl-ubbp
tags: [viz]
---
# Metric endpoints render in mapping detail view (R3)

A mapping whose target (or source) is a metric shows an empty column in the detail view: _renderMappingDetailView (satsuma-viz.ts:1594-1604) resolves endpoints only against ns.schemas, never ns.metrics — even though elk-layout.ts:486 treats metrics as valid mapping endpoints. Repro: examples/metrics-platform, mapping _conversion_rate_pipeline (target conversion_rate). Check fragments-as-endpoints for the same blind spot. See PRD P3/R3.

## Acceptance Criteria

Detail view renders the metric card (sz-metric-card or field-bearing adaptation) for metric sources and targets; field hover/highlight works on metric fields; Playwright test on metrics-platform asserting the conversion_rate TARGET card with fields; coverage for a metric used as a source.


## Notes

**2026-06-10T08:02:19Z**

Cause: _renderMappingDetailView resolved mapping endpoints only against ns.schemas; metrics (schema X (metric,...)) live in ns.metrics, so metric targets/sources rendered an empty column.
Fix: new metric-adapter.ts (metricAsSchemaCard/metricFieldEntries) shared by the detail view and the layout port builder; resolveEndpoint falls back from schemas to metrics, surfacing grain/slice/filter as metadata pills. Fragments are not addressable as mapping endpoints (sourceRefs/targetRef are schema IDs) so no fragment path needed. 3 adapter unit tests + 2 Playwright tests (metric as target via metrics-platform, metric as source via live-edited buffer). Verified 86/86 watcher run 08:56.
