---
id: sl-xav4
status: in_progress
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

