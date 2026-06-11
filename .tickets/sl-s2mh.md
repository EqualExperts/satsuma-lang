---
id: sl-s2mh
status: open
deps: []
links: []
created: 2026-06-11T02:40:50Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, cli]
---
# cli: context emits every metric twice; summary counts metrics as schemas

Metric schemas live in both index.schemas and index.metrics. satsuma-cli/src/commands/context.ts:188-189 scores both, rendering the same block twice (once as schema with note, once as metric) — wasting the token budget the command exists to manage. graph-builder.ts:112-114 deliberately skips metric ids in the schemas loop; context and summary (counts metrics inside "Schemas (14)" while graph stats exclude them) do not. Repro: satsuma context "monthly recurring revenue" examples/metrics-platform/metrics.stm emits schema and metric blocks back to back; --json shows both entries.

## Acceptance Criteria

context emits each metric once (as metric); summary schema/metric counts consistent with graph stats; test against metrics-platform example.

