---
id: sl-xav4
status: closed
deps: []
links: []
created: 2026-06-11T02:40:29Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, cli]
---
# cli: find --in metric never matches; metric fields misreported as blockType schema

satsuma-cli/src/commands/find.ts:110 builds CST node type as blockType + "_block" -> "metric_block", but v2 metrics are schema_block nodes tagged metric (no metric_block node type exists; context.ts:283 documents its removal). The metric branch silently returns nothing. Also :143 reports metric fields with blockType "schema". Repro: satsuma find --tag measure --in metric examples/metrics-platform/metrics.stm -> "No matches found." (exit 1) while --in schema finds all 14 measure fields.

## Acceptance Criteria

find --in metric matches fields in metric-tagged schemas; blockType reported as metric for metric blocks; test against metrics-platform example.


## Notes

**2026-06-11T08:58:24Z**

Cause: find.ts built the CST node type as blockType + "_block" -> "metric_block", which does not exist in v2 (metrics are schema_block nodes tagged metric), so --in metric never matched; the schema loop meanwhile claimed metric fields with blockType "schema".
Fix: map block types to CST node types explicitly (metric -> schema_block), skip metric twins (row-equal entries in both index.schemas and index.metrics) in the schema loop, and report fragment-spread fields of metric-tagged schemas as blockType metric. Verified against examples/metrics-platform/metrics.stm: all 14 measure fields found, no duplicates under scope all. (commit ab3ace9)
